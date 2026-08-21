import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NodePtySessionAdapter } from '../../../../src/main/infrastructure/claude-cli/node-pty-session-adapter.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const stub = (name: string): string => path.join(fixturesDir, name);

describe('NodePtySessionAdapter', () => {
  it('spawns a real PTY, relays written input back through onData, and reports the exit code on close', async () => {
    const adapter = new NodePtySessionAdapter(stub('stub-interactive.sh'));
    const chunks: string[] = [];
    const exits: Array<[string, number]> = [];
    adapter.onData((sessionId, chunk) => chunks.push(chunk));
    adapter.onExit((sessionId, exitCode) => exits.push([sessionId, exitCode]));

    await adapter.spawn('sess-1', process.cwd(), { cols: 80, rows: 24 });
    adapter.write('sess-1', 'hello\r');

    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('ECHO:hello');
    });
    await vi.waitFor(() => {
      expect(exits).toEqual([['sess-1', 7]]);
    });
  });

  it('write/resize/kill on an unknown sessionId are no-ops', () => {
    const adapter = new NodePtySessionAdapter(stub('stub-interactive.sh'));
    expect(() => adapter.write('nope', 'x')).not.toThrow();
    expect(() => adapter.resize('nope', 10, 10)).not.toThrow();
    expect(() => adapter.kill('nope')).not.toThrow();
  });

  it('spawn rejects when the binary does not exist', async () => {
    const adapter = new NodePtySessionAdapter('/definitely/not/a/real/binary-xyz');
    await expect(
      adapter.spawn('sess-2', process.cwd(), { cols: 80, rows: 24 }),
    ).rejects.toThrow();
  });
});
