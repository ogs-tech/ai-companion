export interface TerminalSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

export type TerminalDataListener = (terminalId: string, chunk: string) => void;
export type TerminalExitListener = (terminalId: string, exitCode: number | null, signal: string | null) => void;

/**
 * One PTY per `terminalId`, with input and resize. `onData`/`onExit` each
 * store a single listener (like `ClaudeSessionPort`); the multi-listener
 * fan-out lives one layer up, in `TerminalService`. Spawning under an id that
 * already ran replaces it, and the replaced PTY's late exit is not reported.
 */
export interface TerminalPort {
  spawn(terminalId: string, opts: TerminalSpawnOptions): Promise<void>;
  write(terminalId: string, data: string): void;
  resize(terminalId: string, cols: number, rows: number): void;
  kill(terminalId: string): void;
  onData(listener: TerminalDataListener): void;
  onExit(listener: TerminalExitListener): void;
}
