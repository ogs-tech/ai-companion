import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Box, Button, Stack, Typography, keyframes } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { attachEmbeddedBrowserLinks, embeddedBrowserLinkHandler } from '../lib/terminal-links.js';
import { callIpc, IpcCallError } from '../lib/ipc.js';
import { createTerminalWriteBatcher } from '../lib/terminal-write-batcher.js';
import { sessionsQueryKey, useSessionSnapshot } from '../hooks/use-sessions.js';
import {
  MAX_SESSION_ATTACHMENT_BYTES,
  sessionAnchorKey,
  type SessionActivity,
  type SessionAnchor,
  type SessionSnapshotWithOutput,
} from '../../shared/session.js';
import { StatusPill } from './ds/StatusPill.js';
import { SessionStateMark } from './SessionStateMark.js';
import { EmptyState } from './ds/EmptyState.js';
import {
  registerSessionTab,
} from '../lib/browser-tabs-store.js';
import { Toast, type ToastMessage } from './Toast.js';
import { ogs, colorRoles } from '../tokens.js';
import { ContextBar } from './ContextBar.js';
import { ChannelMark } from './ChannelMark.js';
import { CHANNELS, type ChannelId } from '../../shared/channel.js';
import { formatModel } from '../lib/format-session-history.js';
import type { SessionMetrics } from '../../shared/session-metrics.js';
import { FILTER_LABELS, type SessionRowState } from '../lib/session-attention.js';

const fadeIn = keyframes`from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; }`;
const dots = keyframes`0% { content: ""; } 25% { content: "."; } 50% { content: ".."; } 75%, 100% { content: "..."; }`;

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

/** How long a session may sit with no signal before "iniciando" stops being claimed. */
const STARTING_GRACE_MS = 5000;

/** What the header says: the same four states as the list and the tabs, plus a failure that is not a session state. */
interface HeaderStatus {
  state: SessionRowState | 'error';
  label: string;
  /** Secondary text beside the label ("Edit · 12 s", "iniciando"). */
  detail?: string;
  /** No signal yet: the mark breathes and the detail's dots animate. */
  starting?: boolean;
}

function headerStatusFor(status: PanelStatus, activity: SessionActivity | undefined): HeaderStatus {
  switch (status) {
    case 'error':
      return { state: 'error', label: 'Erro' };
    case 'idle':
    case 'exited':
      return { state: 'exited', label: FILTER_LABELS.exited };
    // A live session with no signal is Ocioso (the doc's rule); "iniciando" is only a detail of it.
    case 'starting':
      return { state: 'idle', label: FILTER_LABELS.idle, detail: 'iniciando', starting: true };
    case 'running': {
      const state = activity ?? 'idle';
      return { state, label: FILTER_LABELS[state] };
    }
  }
}

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

interface SessionStatusLineProps {
  status: HeaderStatus;
  /** Current tool while working ("Edit CartService.ts"); wins over the status's own detail. */
  detail?: string;
  /** Live cost / context. */
  metrics?: SessionMetrics | undefined;
  /** The channel running the session: its mark and name sit on the right, before the model. */
  channel?: ChannelId | undefined;
  action?: React.ReactNode;
}

/** Fixed height, so a state change or a late-arriving sessionId never moves the terminal above it. */
const STATUS_LINE_HEIGHT = 24;
const LINE_MUTED = 'rgba(242, 238, 229, 0.6)';

/** One 24px line flush under the terminal, in the terminal's own colors: state, detail, context, cost, then the action on the right. */
function SessionStatusLine({ status, detail, metrics, channel, action }: SessionStatusLineProps): React.ReactElement {
  const shownDetail = detail ?? status.detail;
  return (
    <Stack
      direction="row"
      spacing={1.5}
      data-testid="session-status-line"
      sx={{
        height: STATUS_LINE_HEIGHT,
        flex: 'none',
        alignItems: 'center',
        px: 1.25,
        bgcolor: 'rgba(255, 255, 255, 0.06)',
        color: ogs.creamInk,
        overflow: 'hidden',
        '& .MuiButton-root': { minHeight: 0, py: 0, lineHeight: '20px', fontSize: '0.75rem', color: 'inherit' },
      }}
    >
      {status.state === 'error' ? (
        <StatusPill variant="error" label={status.label} testId="session" />
      ) : (
        <Stack direction="row" spacing={0.75} data-testid="session-state" data-state={status.state} sx={{ alignItems: 'center', flex: 'none' }}>
          <SessionStateMark state={status.state} size={11} breathing={status.starting === true} />
          <Typography component="span" sx={{ fontSize: '0.75rem', fontWeight: 600 }}>
            {status.label}
          </Typography>
        </Stack>
      )}
      {shownDetail && (
        <Typography
          component="span"
          noWrap
          data-testid="session-detail"
          sx={{
            fontSize: '0.75rem',
            color: LINE_MUTED,
            minWidth: 0,
            '@media (prefers-reduced-motion: no-preference)': {
              animation: `${fadeIn} 0.2s ease-out`,
              ...(status.starting && !detail ? { '&::after': { content: '""', display: 'inline-block', width: '1.2em', textAlign: 'left', animation: `${dots} 1.2s steps(4, end) infinite` } } : {}),
            },
          }}
        >
          {shownDetail}
        </Typography>
      )}
      <Box sx={{ ml: 'auto !important', display: 'flex', alignItems: 'center', gap: 1, flex: 'none', minWidth: 0 }}>
        {channel && (
          <Stack direction="row" spacing={0.75} data-testid="session-channel" data-channel={channel} sx={{ alignItems: 'center', flex: 'none' }}>
            <ChannelMark harness={channel} size={12} />
            <Typography component="span" sx={{ fontSize: '0.75rem' }}>{CHANNELS[channel].displayName}</Typography>
            {metrics?.model && (
              <Typography component="span" data-testid="session-model" sx={{ fontSize: '0.75rem', color: LINE_MUTED }}>
                {`· ${formatModel(metrics.model)}`}
              </Typography>
            )}
          </Stack>
        )}
        <ContextBar metrics={metrics} testId="session-context" onDark />
        {metrics?.costUsd !== undefined && (
          <Typography component="span" data-testid="session-cost" sx={{ fontSize: '0.75rem', color: LINE_MUTED, flex: 'none' }}>
            {`${channel === 'cursor' ? '~' : ''}US$ ${metrics.costUsd.toFixed(2)}`}
          </Typography>
        )}
        {action}
      </Box>
    </Stack>
  );
}

/** Shown in the editor before the entity's first save — there's no urn yet to anchor a session to. */
export function SessionPanelLocked(): React.ReactElement {
  return (
    <Box data-testid="session-panel-locked">
      <EmptyState
        glyph={Lock}
        title="Salve para abrir uma sessão"
        description="Um terminal claude fica ancorado a este item assim que ele existir de verdade."
        testId="session-locked"
      />
      <SessionStatusLine status={{ state: 'exited', label: 'Disponível após salvar' }} />
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
  const [activity, setActivity] = useState<SessionActivity | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // The store is the source of truth once it lists this session; local state only bridges the gap before that.
  const stored = useSessionSnapshot(sessionId);
  const [attachmentToast, setAttachmentToast] = useState<ToastMessage | null>(null);

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
          setActivity(existing.activity);
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

  // "Iniciando" is a claim about the first moments only. The one-shot lookup above can race the
  // spawn (it finds nothing and never runs again), so when no output or activity has arrived
  // within the grace period, ask again and settle on what the main process says.
  useEffect(() => {
    if (status !== 'starting' || !sessionId) return;
    const timer = setTimeout(() => {
      void callIpc<SessionSnapshotWithOutput | null>('session.status', { sessionId })
        .then((snap) => {
          if (snap) setActivity(snap.activity);
          setStatus((current) => (current === 'starting' ? (snap?.status === 'exited' ? 'exited' : 'running') : current));
        })
        .catch(() => setStatus((current) => (current === 'starting' ? 'running' : current)));
    }, STARTING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [status, sessionId]);

  useEffect(() => {
    const terminal = new Terminal({
      convertEol: true,
      fontSize: 13,
      theme: TERMINAL_XTERM_THEME,
      linkHandler: embeddedBrowserLinkHandler,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    attachEmbeddedBrowserLinks(terminal);
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
    const batcher = createTerminalWriteBatcher((data) => terminalRef.current?.write(data));
    const unsubOutput = window.api.session.onOutput(sessionId, (chunk) => {
      batcher.push(chunk);
      // Output proves the process is alive even if the one-shot status lookup raced the spawn.
      setStatus((current) => (current === 'starting' ? 'running' : current));
    });
    // `activity` changes are pushed by main as events carrying only the id; re-read the snapshot.
    const unsubActivity = window.api.session.onAnyActivity((changedId) => {
      if (changedId !== sessionId) return;
      void callIpc<SessionSnapshotWithOutput | null>('session.status', { sessionId })
        .then((snap) => {
          if (!snap) return;
          setActivity(snap.activity);
          if (snap.status === 'running') setStatus((current) => (current === 'starting' ? 'running' : current));
        })
        .catch(() => {
          // Best-effort: the pill keeps its last known state.
        });
    });
    const unsubExit = window.api.session.onExit(sessionId, () => {
      setStatus('exited');
      setActivity(undefined);
    });
    return () => {
      dataDisposable?.dispose();
      unsubOutput();
      unsubActivity();
      unsubExit();
      batcher.cancel();
    };
  }, [sessionId]);

  useEffect(() => {
    // A hidden container (kept mounted in the background so its scrollback
    // survives) reports zero size — fitting against that would shrink the
    // terminal to nothing, so skip until it's visible again, then re-fit.
    // Each resize makes the PTY raise SIGWINCH, and the CLI redraws its whole
    // screen on it — so only tell the PTY when the grid really changed.
    let lastSent = '';
    const syncSize = (): void => {
      if (!visible) return;
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (!dims || !sessionId) return;
      const key = `${dims.cols}x${dims.rows}`;
      if (key === lastSent) return;
      lastSent = key;
      void callIpc('session.resize', { sessionId, cols: dims.cols, rows: dims.rows });
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

  return (
    <Box data-testid="session-panel" sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
      {/* Always rendered at a fixed height: the terminal never jumps when the
          sessionId resolves or the state changes. */}
      <SessionStatusLine status={headerStatusFor(stored ? stored.status : status, stored ? stored.activity : activity)} metrics={stored?.metrics} {...(stored ? { channel: stored.harness } : {})} {...(stored?.activity === 'working' && stored.activityDetail ? { detail: stored.activityDetail } : {})} action={action} />
      <Toast toast={attachmentToast} onDismiss={() => setAttachmentToast(null)} />
    </Box>
  );
}
