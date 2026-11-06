export type LogProcess = 'main' | 'renderer';

export interface LogEntry {
  process: LogProcess;
  message: string;
  stack?: string | undefined;
}

/** Append-only diagnostics sink. Implementations must never throw: logging a failure cannot create another one. */
export interface LoggerPort {
  /** Folder holding the log files — what the Help menu opens. */
  readonly directory: string;
  error(entry: LogEntry): void;
  info(entry: LogEntry): void;
}
