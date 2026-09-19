import { useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent } from 'react';
import { Box, Button, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { SquareTerminal, Lock, Globe } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { callIpc, IpcCallError } from '../lib/ipc.js';
import { sessionsQueryKey } from '../hooks/use-sessions.js';
import {
  MAX_SESSION_ATTACHMENT_BYTES,
  sessionAnchorKey,
  type SessionAnchor,
  type SessionSnapshotWithOutput,
} from '../../shared/session.js';
import { Kicker } from './ds/Kicker.js';
import { Icon } from './ds/Icon.js';
import { StatusPill, type StatusPillVariant } from './ds/StatusPill.js';
import { EmptyState } from './ds/EmptyState.js';
import {
  closeSessionTab,
  getBrowserTabsSnapshot,
  openSessionTab,
  registerSessionTab,
  subscribeBrowserTabs,
} from '../lib/browser-tabs-store.js';
import { Toast, type ToastMessage } from './Toast.js';
import { ogs, colorRoles } from '../tokens.js';
import { SESSION_STATUS_PILL } from '../lib/session-status-pill.js';

type PanelStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error';

interface SessionPanelProps {
  anchor: SessionAnchor;
  /**
   * The concrete session this panel is already attached to — passed by every
   * tab opened from the Workbench (any anchor kind), where the caller
   * already holds a live or resumed `sessionId` from a `spawn`/`resume`
   * response or an existing `SessionSnapshot` row. When present, the panel
   * attaches directly via `session.status(sessionId)` instead of deriving an
   * id from the anchor, skips the idle "Abrir sessão" state entirely, and
   * its inline "Retomar" action calls `session.resume(sessionId)`. Absent
   * only for a caller that doesn't yet have a session to attach to, which
   * keeps today's mount-time anchor-keyed reattach and click-to-spawn flow.
   */
  sessionId?: string;
  /** Whether this panel is the one currently in focus. Panels kept mounted in the background (visible=false) skip resize/fit so a zero-size container doesn't miscalculate the terminal's dimensions. */
  visible?: boolean;
}

const STATUS_PILL: Record<PanelStatus, { variant: StatusPillVariant; label: string }> = {
  idle: { variant: 'idle', label: 'Parada' },
  starting: { variant: 'starting', label: 'Iniciando' },
  error: { variant: 'error', label: 'Erro' },
  ...SESSION_STATUS_PILL,
};

// A real terminal reads as its own environment, not as a themed app panel —
// so this stays ink-on-cream regardless of the app's light/dark mode.
const TERMINAL_XTERM_THEME = {
  background: ogs.ink,
  foreground: ogs.creamInk,
  cursor: colorRoles.dark.azul,
};

/**
 * What `Shift+Enter` writes to the PTY in place of xterm's own `\r`.
 *
 * xterm.js emits `\r` for `Enter` and `Shift+Enter` alike, so the CLI can't
 * tell them apart and submits on both. `\x1b\r` (ESC + CR) is the sequence
 * the `claude` CLI reads as "insert a newline, don't submit" — it is exactly
 * what `claude /terminal-setup` binds `shift+enter` to when it patches a host
 * terminal's keymap (in VS Code it writes a
 * `workbench.action.terminal.sendSequence` binding with `"text": "\u001b\r"`).
 * The CLI also documents `\\\r` (backslash + return), but that one leaves a
 * literal backslash behind on a build that doesn't strip it, whereas an
 * unrecognized ESC+CR degrades to nothing.
 */
export const TERMINAL_NEWLINE_SEQUENCE = '\x1b\r';

/**
 * Fail fast in the app instead of waiting for the CLI to reject it: an
 * oversized or unsupported image is rejected here for both a dropped file
 * (which otherwise has no other restriction — a dropped `.txt` or `.pdf`
 * passes through untouched) and a pasted one (which additionally has to be
 * staged to disk first, so there's no point staging bytes the CLI will
 * refuse to read anyway).
 */
const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function imageAttachmentError(blob: { size: number; type: string }): string | null {
  if (!(blob.type in IMAGE_EXTENSION_BY_MIME)) return `Formato de imagem não suportado: ${blob.type || 'desconhecido'}`;
  if (blob.size > MAX_SESSION_ATTACHMENT_BYTES) return 'Imagem maior que 5MB — o claude não consegue lê-la';
  return null;
}

/** `FileReader` is the simplest way to get base64 out of a `Blob` in the renderer — there's no `Buffer` here. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Falha ao ler a imagem colada'));
    reader.readAsDataURL(file);
  });
}

/** A raw control byte (`\r`, `\n`, ESC…) in a file name would reach the PTY as a real terminal keystroke once it's part of an `@<path>` reference — e.g. a `\r` submits the line early, mid-prompt, with whatever text follows it. Rejected outright rather than stripped, since a stripped name could silently point at a different file than the one the user dropped. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point: a path containing one is rejected before it reaches the PTY.
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

/** Backslash-escapes spaces (and literal backslashes) the way a real terminal represents a dragged-in path — otherwise a space inside a path reads as the end of the `@` reference, and joining several references becomes ambiguous. */
function escapeAttachmentPath(path: string): string {
  return path.replace(/[\\ ]/g, '\\$&');
}

/** The one place that knows the `@<path> ` wire format both attachment flows write into the session — kept in sync here instead of once per call site. */
function attachmentRefData(paths: string[]): string {
  return `${paths.map((path) => `@${escapeAttachmentPath(path)}`).join(' ')} `;
}

interface SessionHeaderProps {
  pill: { variant: StatusPillVariant; label: string };
  action?: React.ReactNode;
  browserToggle?: React.ReactNode;
}

function SessionHeader({ pill, action, browserToggle }: SessionHeaderProps): React.ReactElement {
  return (
    <Stack
      direction="row"
      sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', rowGap: 1 }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Icon glyph={SquareTerminal} size={16} />
        <Kicker>Sessão</Kicker>
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <StatusPill variant={pill.variant} label={pill.label} testId="session" />
        {browserToggle}
        {action}
      </Stack>
    </Stack>
  );
}

/** Shown in the editor before the entity's first save — there's no urn yet to anchor a session to. */
export function SessionPanelLocked(): React.ReactElement {
  return (
    <Box data-testid="session-panel-locked">
      <SessionHeader pill={{ variant: 'idle', label: 'Disponível após salvar' }} />
      <EmptyState
        glyph={Lock}
        title="Salve para abrir uma sessão"
        description="Um terminal claude fica ancorado a este item assim que ele existir de verdade."
        testId="session-locked"
      />
    </Box>
  );
}

export function SessionPanel({ anchor, sessionId: sessionIdProp, visible = true }: SessionPanelProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const queryClient = useQueryClient();

  const [sessionId, setSessionId] = useState<string | null>(sessionIdProp ?? null);
  // The Shift+Enter handler is attached once, at terminal creation, but the
  // session it must write to changes over the panel's life (idle → spawned,
  // or a new sessionId prop). It reads the id from this ref at keypress time
  // rather than forcing the handler to be re-attached on every id change.
  const sessionIdRef = useRef<string | null>(sessionIdProp ?? null);
  const [status, setStatus] = useState<PanelStatus>(sessionIdProp ? 'starting' : 'idle');
  const [error, setError] = useState<string | null>(null);
  // Derived, not local state: the same session's browser can also be turned
  // off from its Workbench tab's own close button (see browser-tabs-store's
  // `closeBrowserTab`), so this has to track the shared store rather than a
  // copy that only this component's own toggle click ever updates.
  const { tabs: browserTabs } = useSyncExternalStore(subscribeBrowserTabs, getBrowserTabsSnapshot);
  const browserEnabled = sessionId !== null && browserTabs.some((tab) => tab.tabId === sessionId);
  const [attachmentToast, setAttachmentToast] = useState<ToastMessage | null>(null);
  /** True while `browser.enable`/`browser.disable` is in flight — that call restarts the session's own `claude` process when it's running, so the toggle is disabled meanwhile rather than letting a second click queue up another restart mid-flight. */
  const [browserToggling, setBrowserToggling] = useState(false);

  // Attaches to a session already running server-side. When the caller
  // already knows a concrete sessionId (every Workbench tab, opened from a
  // spawn/resume response or an existing SessionSnapshot row), that id is
  // looked up directly — no idle "Abrir sessão" gate, since one is known to
  // exist by construction. Otherwise (only the CustomizationEditor-style
  // usage today), the anchor's own key doubles as its sessionId, so this is
  // still a plain lookup, no spawn needed — it just may find nothing yet.
  useEffect(() => {
    const lookupId = sessionIdProp ?? sessionAnchorKey(anchor);
    let active = true;
    void (async () => {
      try {
        const existing = await callIpc<SessionSnapshotWithOutput | null>('session.status', { sessionId: lookupId });
        if (active && existing) {
          if (!sessionIdProp) setSessionId(existing.sessionId);
          setStatus(existing.status === 'exited' ? 'exited' : 'running');
          // Re-attaching to a session whose browser was already on: its tab
          // already exists main-process side, so this only needs to tell the
          // global browser store it exists — never steals focus or opens the
          // panel the way a fresh toggle click does.
          if (existing.browserEnabled) registerSessionTab(existing.sessionId);
          // Written straight to the terminal (not through React state) so it
          // lands before the live onOutput subscription below ever starts —
          // by the time this resolves, the terminal-creation effect has
          // already run (it has no async gap), so the ref is populated.
          if (existing.outputBuffer) terminalRef.current?.write(existing.outputBuffer);
        }
      } catch {
        // No session to reattach to — stay idle/starting, same as a fresh anchor/session.
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdProp, sessionAnchorKey(anchor)]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const terminal = new Terminal({ convertEol: true, fontSize: 13, theme: TERMINAL_XTERM_THEME });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    // There is no React <textarea> here to intercept — the terminal is a real
    // PTY and every keystroke is already bytes. So Shift+Enter is claimed at
    // the DOM keyboard event, before xterm turns it into the same `\r` a
    // plain Enter produces, and the newline sequence is written by hand.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      if (event.key !== 'Enter' || !event.shiftKey) return true;
      // Alt/Ctrl/Cmd+Shift+Enter are the CLI's own gestures — left alone.
      if (event.altKey || event.ctrlKey || event.metaKey) return true;
      const id = sessionIdRef.current;
      if (id) void callIpc('session.write', { sessionId: id, data: TERMINAL_NEWLINE_SEQUENCE });
      // `return false` only stops xterm's own processing — it does not cancel the DOM
      // event, because xterm bails out before the `cancel()` its handled path calls. The
      // browser then fires the legacy `keypress`, which Enter (alone among non-printable
      // keys) still emits, and xterm's `_keyPress` turns its charCode 13 back into a `\r`
      // the CLI reads as "submit". Cancelling here is what stops that second event.
      event.preventDefault();
      return false;
    });
    if (containerRef.current) terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const dataDisposable = terminalRef.current?.onData((data) => {
      void callIpc('session.write', { sessionId, data });
    });
    const unsubOutput = window.api.session.onOutput(sessionId, (chunk) => {
      terminalRef.current?.write(chunk);
    });
    const unsubExit = window.api.session.onExit(sessionId, () => {
      setStatus('exited');
    });
    return () => {
      dataDisposable?.dispose();
      unsubOutput();
      unsubExit();
    };
  }, [sessionId]);

  useEffect(() => {
    // A hidden container (kept mounted in the background so its scrollback
    // survives) reports zero size — fitting against that would shrink the
    // terminal to nothing, so skip until it's visible again, then re-fit.
    const syncSize = (): void => {
      if (!visible) return;
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims && sessionId) {
        void callIpc('session.resize', { sessionId, cols: dims.cols, rows: dims.rows });
      }
    };
    syncSize();
    window.addEventListener('resize', syncSize);
    // The container's own box can change size without a window resize event
    // ever firing — the split-pane layout settling after mount, a sidebar
    // collapsing, a divider drag, a tab switch — so `fit()` also needs to
    // react to the container itself, or the terminal's rows/cols go stale
    // and its bottom edge (the CLI's input box and status line) ends up
    // clipped by this box's `overflow: hidden`.
    const resizeObserver = new ResizeObserver(syncSize);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => {
      window.removeEventListener('resize', syncSize);
      resizeObserver.disconnect();
    };
  }, [sessionId, visible]);

  const handleOpen = async (): Promise<void> => {
    setStatus('starting');
    setError(null);
    try {
      const session = await callIpc<SessionSnapshotWithOutput>('session.spawn', { anchor });
      setSessionId(session.sessionId);
      setStatus(session.status === 'exited' ? 'exited' : 'running');
      if (session.browserEnabled) registerSessionTab(session.sessionId);
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      // The resize effect below reacts to `sessionId` changing and fits/resizes
      // itself — no need to duplicate that call here.
    } catch (err) {
      setStatus('error');
      setError(err instanceof IpcCallError ? err.message : String(err));
    }
  };

  const handleResume = async (id: string): Promise<void> => {
    setStatus('starting');
    setError(null);
    try {
      const session = await callIpc<SessionSnapshotWithOutput>('session.resume', { sessionId: id });
      setStatus(session.status === 'exited' ? 'exited' : 'running');
      if (session.browserEnabled) registerSessionTab(session.sessionId);
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    } catch (err) {
      setStatus('error');
      setError(err instanceof IpcCallError ? err.message : String(err));
    }
  };

  const showAttachmentError = (message: string): void => setAttachmentToast({ variant: 'error', message });

  // Allows the subsequent `drop` to fire at all — a browser rejects it by default.
  const handleAttachmentDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
  };

  // A file dropped from Finder already has a real filesystem path — no need
  // to stage it, just reference it the same way "New Action" pre-populates a
  // session (`@<path>`) and let the CLI itself read it from disk.
  const handleAttachmentDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const id = sessionIdRef.current;
    if (!id) return;
    const paths: string[] = [];
    for (const file of Array.from(event.dataTransfer.files)) {
      if (file.type.startsWith('image/')) {
        const error = imageAttachmentError(file);
        if (error) {
          showAttachmentError(error);
          continue;
        }
      }
      let path: string;
      try {
        // Only ever throws for a `File` not backed by a real filesystem entry
        // (e.g. one built in JS) — never for an ordinary Finder drop, but a
        // compromised renderer isn't the only way a `File` could arrive here.
        path = window.api.getPathForFile(file);
      } catch {
        showAttachmentError(`Não foi possível resolver o caminho de "${file.name}"`);
        continue;
      }
      if (!path || CONTROL_CHAR_PATTERN.test(path)) {
        showAttachmentError(`Nome de arquivo inválido: "${file.name}"`);
        continue;
      }
      paths.push(path);
    }
    if (paths.length > 0) void callIpc('session.write', { sessionId: id, data: attachmentRefData(paths) });
  };

  // A clipboard image has no path of its own, unlike a drop — it has to be
  // staged to disk first (`session.stageAttachment`) before it can be
  // referenced the same way. Claimed only when the clipboard carries an
  // image and no plain-text alternative — a rich copy (a spreadsheet range,
  // a rendered web selection) commonly carries both, and the text is what
  // the user meant to paste into the prompt.
  const handleAttachmentPaste = async (event: ClipboardEvent<HTMLDivElement>): Promise<void> => {
    const id = sessionIdRef.current;
    const items = Array.from(event.clipboardData.items);
    const hasText = items.some((it) => it.type === 'text/plain');
    const item = hasText ? undefined : items.find((it) => it.type.startsWith('image/'));
    if (!id || !item) return;
    event.stopPropagation();
    event.preventDefault();
    const file = item.getAsFile();
    if (!file) return;
    const error = imageAttachmentError(file);
    if (error) {
      showAttachmentError(error);
      return;
    }
    const fileName = file.name || `screenshot.${IMAGE_EXTENSION_BY_MIME[file.type]}`;
    try {
      const dataBase64 = await readAsBase64(file);
      const { absolutePath } = await callIpc<{ absolutePath: string }>('session.stageAttachment', { fileName, dataBase64 });
      void callIpc('session.write', { sessionId: id, data: attachmentRefData([absolutePath]) });
    } catch (err) {
      showAttachmentError(err instanceof IpcCallError ? err.message : String(err));
    }
  };

  // Restarts the session's own `claude` process on the main-process side when
  // it's running (the CLI only reads `--mcp-config` at its own startup) — the
  // toggle is disabled for the duration so a second click can't queue up a
  // restart on top of one already in flight. On success, opens (or forgets)
  // this session's own Workbench browser tab — `browserEnabled` above is
  // derived from that same store, so the icon's color/tooltip follow along.
  const handleToggleBrowser = async (): Promise<void> => {
    if (!sessionId) return;
    const next = !browserEnabled;
    setBrowserToggling(true);
    try {
      await callIpc(next ? 'browser.enable' : 'browser.disable', { sessionId });
      if (next) openSessionTab(sessionId);
      else closeSessionTab(sessionId);
    } catch (err) {
      setError(err instanceof IpcCallError ? err.message : String(err));
    } finally {
      setBrowserToggling(false);
    }
  };

  // Once a concrete sessionId is known (from the prop, or from an earlier
  // handleOpen), reconnecting means resuming that same session; only a
  // caller that never had one falls back to spawning fresh from the anchor.
  const reconnect = (): void => {
    void (sessionIdProp ? handleResume(sessionIdProp) : handleOpen());
  };

  const action =
    status === 'idle' || status === 'error' ? (
      <Button variant="outlined" size="small" onClick={reconnect} data-testid="session-open">
        {status === 'error' ? 'Tentar novamente' : 'Abrir sessão'}
      </Button>
    ) : status === 'exited' ? (
      <Button size="small" onClick={reconnect} data-testid="session-resume">
        Retomar
      </Button>
    ) : null;

  // Once a concrete sessionId exists, the embedded browser tool can be
  // toggled regardless of run state (idle/starting has none yet to key it by).
  // Turning it on opens the session's own tab in the Workbench's tab strip
  // (WorkspaceScreen) — turning it off tears the tab down, not just hides it
  // (and can also be done from that tab's own close button), so the label
  // says "ativar"/"desativar", not "mostrar"/"ocultar".
  const browserToggle = sessionId ? (
    <Tooltip
      title={
        browserToggling
          ? 'Reiniciando sessão…'
          : browserEnabled
            ? 'Desativar navegador da sessão'
            : 'Ativar navegador da sessão'
      }
    >
      <span>
        <IconButton
          size="small"
          data-testid="session-browser-toggle"
          aria-label={browserEnabled ? 'Desativar navegador da sessão' : 'Ativar navegador da sessão'}
          color={browserEnabled ? 'primary' : 'default'}
          disabled={browserToggling}
          onClick={() => void handleToggleBrowser()}
        >
          <Icon glyph={Globe} size={16} />
        </IconButton>
      </span>
    </Tooltip>
  ) : null;

  // The header carries an action (Abrir sessão / Tentar novamente / Retomar)
  // for idle, error, or exited states, and the browser toggle for any state
  // that has a concrete sessionId — a running session with no toggle yet
  // (the sessionId hasn't resolved) drops the header entirely so the terminal
  // fills the whole tab, reading as a real terminal instead of a themed app
  // panel with a chrome bar on top.
  const showHeader = action !== null || browserToggle !== null;

  return (
    <Box data-testid="session-panel" sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {showHeader && (
        <Box sx={{ px: 2, pt: 2 }}>
          <SessionHeader pill={STATUS_PILL[status]} action={action} browserToggle={browserToggle} />
        </Box>
      )}
      {error && (
        <Typography color="error" data-testid="session-error" sx={{ mx: 2, mb: 1.5, flexShrink: 0 }}>
          {error}
        </Typography>
      )}
      {/* No padding, border, or radius here — a running session drops the
          header above and this box is the only thing left in the tab, so any
          inset chrome would read as "a panel with a terminal in it" rather
          than the terminal being the page. */}
      {/* No padding here, ever — xterm's FitAddon measures this element's own
          clientHeight/Width (the parent it was `open()`ed into) to compute
          rows/cols. Padding on it would size the terminal to include the
          padded-away space, and the CLI's own bottom-most row (its input box
          and status line) would render past `overflow: hidden` and clip. */}
      <Box
        ref={containerRef}
        data-testid="session-terminal"
        onDragOver={handleAttachmentDragOver}
        onDrop={handleAttachmentDrop}
        onPasteCapture={(event) => void handleAttachmentPaste(event)}
        sx={{
          flexGrow: 1,
          minHeight: 0,
          bgcolor: ogs.ink,
          overflow: 'hidden',
        }}
      />
      <Toast toast={attachmentToast} onDismiss={() => setAttachmentToast(null)} />
    </Box>
  );
}
