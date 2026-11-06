import type { LogEntry } from '../ports/logger-port.js';

const escapeNewlines = (text: string): string => text.replace(/\r?\n/g, '\\n').replace(/\t/g, ' ');

/**
 * One tab-separated line per entry: ISO date, app version, process, level, message, stack.
 * Newlines inside the message or the stack are escaped so one entry is always one line.
 */
export function formatLogLine(level: 'ERROR' | 'INFO', entry: LogEntry, version: string, now: Date): string {
  const stack = entry.stack === undefined || entry.stack === '' ? '' : escapeNewlines(entry.stack);
  return [now.toISOString(), version, entry.process, level, escapeNewlines(entry.message), stack].join('\t') + '\n';
}
