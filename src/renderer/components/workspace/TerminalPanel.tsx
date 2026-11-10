import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { attachEmbeddedBrowserLinks, embeddedBrowserLinkHandler } from '../../lib/terminal-links.js';
import { callIpc } from '../../lib/ipc.js';
import { createTerminalWriteBatcher } from '../../lib/terminal-write-batcher.js';
import { ogs } from '../../tokens.js';
import type { TerminalSnapshotWithOutput } from '../../../shared/terminal.js';

const TERMINAL_XTERM_THEME = { background: ogs.ink, foreground: ogs.cream, cursor: ogs.cream };

/** Which IPC methods back this panel — workspace terminals by default; the Config setup dialog points at `channelSetup.*`. */
export interface TerminalPanelIpc {
  write: string;
  resize: string;
  status: string;
}
const WORKSPACE_TERMINAL_IPC: TerminalPanelIpc = { write: 'terminal.write', resize: 'terminal.resize', status: 'terminal.status' };

interface TerminalPanelProps {
  terminalId: string;
  ipc?: TerminalPanelIpc;
  /** Skips resize/fit while the tab is hidden — a hidden container reports zero size. */
  visible?: boolean;
}

/**
 * A view onto a terminal owned by the main process. Mounting replays the
 * scrollback; unmounting (closing the tab) leaves the process running. A
 * restart gives the terminal a new `generation`, which callers use as part of
 * this component's `key` so the replay starts over.
 */
export function TerminalPanel({ terminalId, ipc = WORKSPACE_TERMINAL_IPC, visible = true }: TerminalPanelProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      theme: TERMINAL_XTERM_THEME,
      linkHandler: embeddedBrowserLinkHandler,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    attachEmbeddedBrowserLinks(terminal);
    if (containerRef.current) terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const inputDisposable = terminal.onData((data) => {
      void callIpc(ipc.write, { terminalId, data });
    });
    // Live chunks are dropped until the replay lands: push events and the
    // `terminal.status` reply share one ordered channel, so anything received
    // before the reply is already inside its buffer, and anything after it is
    // new. Subscribing first means nothing falls in between.
    let live = false;
    const batcher = createTerminalWriteBatcher((data) => terminal.write(data));
    const unsubOutput = window.api.terminal.onOutput(terminalId, (chunk) => {
      if (live) batcher.push(chunk);
    });
    const unsubExit = window.api.terminal.onExit(terminalId, (exitCode) => {
      batcher.flush();
      terminal.write(`\r\n\x1b[2m[processo encerrado${exitCode === null ? '' : ` — código ${exitCode}`}]\x1b[0m\r\n`);
    });
    let disposed = false;
    void callIpc<Pick<TerminalSnapshotWithOutput, 'outputBuffer'> | null>(ipc.status, { terminalId })
      .then((snapshot) => {
        if (disposed) return;
        if (snapshot?.outputBuffer) terminal.write(snapshot.outputBuffer);
        live = true;
      })
      .catch(() => {
        live = true;
      });

    return () => {
      disposed = true;
      inputDisposable.dispose();
      unsubOutput();
      unsubExit();
      batcher.cancel();
      terminal.dispose();
    };
  }, [terminalId, ipc]);

  useEffect(() => {
    // Each resize makes the PTY raise SIGWINCH, and many CLIs redraw their whole
    // screen on it — so only tell the PTY when the grid really changed.
    let lastSent = '';
    const syncSize = (): void => {
      if (!visible) return;
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (!dims) return;
      const key = `${dims.cols}x${dims.rows}`;
      if (key === lastSent) return;
      lastSent = key;
      void callIpc(ipc.resize, { terminalId, cols: dims.cols, rows: dims.rows });
    };
    syncSize();
    window.addEventListener('resize', syncSize);
    const resizeObserver = new ResizeObserver(syncSize);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => {
      window.removeEventListener('resize', syncSize);
      resizeObserver.disconnect();
    };
  }, [terminalId, ipc, visible]);

  useEffect(() => {
    if (visible) terminalRef.current?.focus();
  }, [visible]);

  return (
    // Padding lives on this wrapper, never on the host xterm opens into:
    // FitAddon reads the host's computed `width`, which under `border-box`
    // includes padding — so a padded host yields too many columns, the grid
    // overflows horizontally, the scrollbar toggles the layout and the
    // ResizeObserver re-fits in a loop (visible as flicker).
    <Box sx={{ height: '100%', width: '100%', bgcolor: ogs.ink, p: 1, boxSizing: 'border-box' }}>
      <Box
        ref={containerRef}
        data-testid={`terminal-panel-${terminalId}`}
        sx={{ height: '100%', width: '100%', overflow: 'hidden' }}
      />
    </Box>
  );
}
