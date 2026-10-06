import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useLaunchProcessOutput } from '../../hooks/use-launch-process.js';

const TERMINAL_XTERM_THEME = { background: '#fdf6e3', foreground: '#586e75' };

interface LaunchProcessPanelProps {
  processId: string;
  /** Skips resize/fit while the tab is hidden — mirrors SessionPanel's own `visible` handling. */
  visible?: boolean;
}

/** One-directional (process → panel) read-only terminal view for a launched config's stdout/stderr — no write/resize-to-process plumbing, unlike SessionPanel's PTY. */
export function LaunchProcessPanel({ processId, visible = true }: LaunchProcessPanelProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const writtenLineCount = useRef(0);
  const { lines } = useLaunchProcessOutput(processId);

  useEffect(() => {
    const terminal = new Terminal({ convertEol: true, fontSize: 13, theme: TERMINAL_XTERM_THEME, disableStdin: true });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    if (containerRef.current) terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    return () => {
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    for (const line of lines.slice(writtenLineCount.current)) {
      terminalRef.current?.write(line.chunk);
    }
    writtenLineCount.current = lines.length;
  }, [lines]);

  useEffect(() => {
    const syncSize = (): void => {
      if (!visible) return;
      fitAddonRef.current?.fit();
    };
    syncSize();
    window.addEventListener('resize', syncSize);
    const resizeObserver = new ResizeObserver(syncSize);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => {
      window.removeEventListener('resize', syncSize);
      resizeObserver.disconnect();
    };
  }, [visible]);

  return <Box ref={containerRef} data-testid={`launch-process-panel-${processId}`} sx={{ height: '100%', width: '100%' }} />;
}
