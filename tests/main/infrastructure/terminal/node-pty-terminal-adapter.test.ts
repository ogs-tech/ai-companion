import { describe, it, expect, vi } from 'vitest';
import { NodePtyTerminalAdapter } from '../../../../src/main/infrastructure/terminal/node-pty-terminal-adapter.js';

const opts = (command: string, args: string[]) => ({ command, args, cwd: process.cwd(), cols: 80, rows: 24 });

describe('NodePtyTerminalAdapter', () => {
  it('runs a command in a real PTY, relays input, and reports the exit code', async () => {
    const adapter = new NodePtyTerminalAdapter();
    const chunks: string[] = [];
    const exits: Array<[string, number | null]> = [];
    adapter.onData((_id, chunk) => chunks.push(chunk));
    adapter.onExit((id, exitCode) => exits.push([id, exitCode]));

    await adapter.spawn('t1', opts('/bin/sh', ['-c', 'read line; echo "ECHO:$line"; exit 7']));
    adapter.write('t1', 'hello\r');

    await vi.waitFor(() => expect(chunks.join('')).toContain('ECHO:hello'), { timeout: 5000 });
    await vi.waitFor(() => expect(exits).toEqual([['t1', 7]]), { timeout: 5000 });
  });

  it('rejects when the binary cannot be started', async () => {
    const adapter = new NodePtyTerminalAdapter();
    await expect(adapter.spawn('t1', opts('/definitely/not/a/binary', []))).rejects.toThrow();
  });

  it('kill ends a running process and a late resize on it is harmless', async () => {
    const adapter = new NodePtyTerminalAdapter();
    const exits: string[] = [];
    adapter.onData(() => undefined);
    adapter.onExit((id) => exits.push(id));
    await adapter.spawn('t1', opts('/bin/sh', ['-c', 'sleep 2']));
    adapter.kill('t1');
    await vi.waitFor(() => expect(exits).toEqual(['t1']), { timeout: 5000 });
    expect(() => adapter.resize('t1', 100, 30)).not.toThrow();
  });

  it('does not leak a replaced PTY\'s exit into the id\'s new run', async () => {
    const adapter = new NodePtyTerminalAdapter();
    const exits: Array<[string, number | null]> = [];
    adapter.onData(() => undefined);
    adapter.onExit((id, code) => exits.push([id, code]));
    await adapter.spawn('t1', opts('/bin/sh', ['-c', 'sleep 2']));
    await adapter.spawn('t1', opts('/bin/sh', ['-c', 'sleep 0.3; exit 4']));
    await vi.waitFor(() => expect(exits).toEqual([['t1', 4]]), { timeout: 5000 });
  });
});
