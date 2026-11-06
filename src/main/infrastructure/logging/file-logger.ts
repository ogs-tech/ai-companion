import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogEntry, LoggerPort } from '../../application/ports/logger-port.js';
import { formatLogLine } from '../../application/desktop/log-format.js';

export const LOG_FILE_NAME = 'app.log';
export const LOG_MAX_BYTES = 1024 * 1024;
export const LOG_MAX_FILES = 5;

export interface FileLoggerOptions {
  directory: string;
  version: string;
  maxBytes?: number;
  /** Total files kept, the active one included: `app.log`, `app.log.1`, … */
  maxFiles?: number;
  now?: () => Date;
}

/**
 * Synchronous on purpose: it is called from crash handlers, where an async write could be lost.
 * Rotation shifts `app.log` → `app.log.1` → … and drops the oldest once `maxFiles` is reached.
 */
export class FileLogger implements LoggerPort {
  readonly directory: string;
  private readonly version: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly now: () => Date;

  constructor(options: FileLoggerOptions) {
    this.directory = options.directory;
    this.version = options.version;
    this.maxBytes = options.maxBytes ?? LOG_MAX_BYTES;
    this.maxFiles = options.maxFiles ?? LOG_MAX_FILES;
    this.now = options.now ?? (() => new Date());
  }

  error(entry: LogEntry): void {
    this.write('ERROR', entry);
  }

  info(entry: LogEntry): void {
    this.write('INFO', entry);
  }

  private write(level: 'ERROR' | 'INFO', entry: LogEntry): void {
    const line = formatLogLine(level, entry, this.version, this.now());
    try {
      mkdirSync(this.directory, { recursive: true });
      this.rotateIfNeeded(Buffer.byteLength(line));
      appendFileSync(this.path(0), line, 'utf8');
    } catch (error) {
      console.error('[logger] could not write log line:', error, line);
    }
  }

  private path(index: number): string {
    return join(this.directory, index === 0 ? LOG_FILE_NAME : `${LOG_FILE_NAME}.${index}`);
  }

  private rotateIfNeeded(incomingBytes: number): void {
    let size = 0;
    try {
      size = statSync(this.path(0)).size;
    } catch {
      return; // No active file yet.
    }
    if (size + incomingBytes <= this.maxBytes) return;
    rmSync(this.path(this.maxFiles - 1), { force: true });
    for (let i = this.maxFiles - 2; i >= 0; i--) {
      try {
        renameSync(this.path(i), this.path(i + 1));
      } catch {
        // Gap in the sequence: nothing to shift.
      }
    }
  }
}
