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

    await adapter.spawn('sess-1', process.cwd(), { cols: 80, rows: 24, continueConversation: true });
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
      adapter.spawn('sess-2', process.cwd(), { cols: 80, rows: 24, continueConversation: true }),
    ).rejects.toThrow();
  });

  it('retries once without --continue when claude reports no prior conversation, without surfacing the failed attempt as an exit', async () => {
    const adapter = new NodePtySessionAdapter(stub('stub-no-conversation.sh'));
    const chunks: string[] = [];
    const exits: Array<[string, number]> = [];
    adapter.onData((sessionId, chunk) => chunks.push(chunk));
    adapter.onExit((sessionId, exitCode) => exits.push([sessionId, exitCode]));

    await adapter.spawn('sess-3', process.cwd(), { cols: 80, rows: 24, continueConversation: true });

    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('READY');
    });
    expect(exits).toEqual([]);

    adapter.write('sess-3', 'hello\r');

    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('ECHO:hello');
    });
    await vi.waitFor(() => {
      expect(exits).toEqual([['sess-3', 7]]);
    });
  });

  it('with continueConversation:false, never attempts --continue — no failed-attempt flash, no retry, starts clean immediately', async () => {
    const adapter = new NodePtySessionAdapter(stub('stub-no-conversation.sh'));
    const chunks: string[] = [];
    const exits: Array<[string, number]> = [];
    adapter.onData((sessionId, chunk) => chunks.push(chunk));
    adapter.onExit((sessionId, exitCode) => exits.push([sessionId, exitCode]));

    await adapter.spawn('sess-4', process.cwd(), { cols: 80, rows: 24, continueConversation: false });

    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('READY');
    });
    expect(chunks.join('')).not.toContain('No conversation found to continue');
    expect(exits).toEqual([]);
  });
});
