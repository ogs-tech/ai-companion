import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLogger } from '../../../../src/main/infrastructure/logging/file-logger.js';
import { formatLogLine } from '../../../../src/main/application/desktop/log-format.js';

describe('formatLogLine', () => {
  it('writes date, version, process, level, message and stack on one line', () => {
    const line = formatLogLine('ERROR', { process: 'main', message: 'boom\nsecond', stack: 'Error: boom\n  at x' }, '1.2.3', new Date('2026-11-05T10:00:00.000Z'));
    expect(line).toBe('2026-11-05T10:00:00.000Z\t1.2.3\tmain\tERROR\tboom\\nsecond\tError: boom\\n  at x\n');
  });
});

describe('FileLogger', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'logger-test-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const make = (maxBytes: number, maxFiles = 5) =>
    new FileLogger({ directory: join(dir, 'logs'), version: '0.0.1', maxBytes, maxFiles, now: () => new Date('2026-11-05T10:00:00.000Z') });

  it('creates the directory and appends entries', () => {
    const logger = make(10_000);
    logger.error({ process: 'main', message: 'one' });
    logger.info({ process: 'renderer', message: 'two' });
    const lines = readFileSync(join(dir, 'logs', 'app.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('\tmain\tERROR\tone');
    expect(lines[1]).toContain('\trenderer\tINFO\ttwo');
  });

  it('rotates when the active file would exceed the size limit', () => {
    const logger = make(200);
    for (let i = 0; i < 6; i++) logger.error({ process: 'main', message: `entry-${i} ${'x'.repeat(60)}` });
    const files = readdirSync(join(dir, 'logs')).sort();
    expect(files).toContain('app.log');
    expect(files).toContain('app.log.1');
    expect(readFileSync(join(dir, 'logs', 'app.log'), 'utf8')).toContain('entry-5');
    expect(readFileSync(join(dir, 'logs', 'app.log.1'), 'utf8')).toContain('entry-4');
  });

  it('keeps at most maxFiles files, dropping the oldest', () => {
    const logger = make(100, 3);
    for (let i = 0; i < 30; i++) logger.error({ process: 'main', message: `entry-${i} ${'x'.repeat(60)}` });
    const files = readdirSync(join(dir, 'logs')).sort();
    expect(files).toEqual(['app.log', 'app.log.1', 'app.log.2']);
    const all = files.map((f) => readFileSync(join(dir, 'logs', f), 'utf8')).join('');
    expect(all).toContain('entry-29');
    expect(all).not.toContain('entry-0 ');
  });

  it('defaults to 5 files of 1 MB', () => {
    const logger = new FileLogger({ directory: join(dir, 'logs'), version: '0' });
    const big = 'y'.repeat(400_000);
    for (let i = 0; i < 40; i++) logger.error({ process: 'main', message: big });
    expect(readdirSync(join(dir, 'logs')).length).toBe(5);
  });
});
