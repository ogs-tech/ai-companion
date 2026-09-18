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

    await adapter.spawn('sess-1', process.cwd(), {
      cols: 80,
      rows: 24,
      conversation: { mode: 'start', claudeSessionId: 'c-1' },
    });
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
      adapter.spawn('sess-2', process.cwd(), {
        cols: 80,
        rows: 24,
        conversation: { mode: 'start', claudeSessionId: 'c-2' },
      }),
    ).rejects.toThrow();
  });

  it('falls back to creating the conversation when a resume finds none, without surfacing the failed attempt as an exit', async () => {
    const adapter = new NodePtySessionAdapter(stub('stub-no-conversation.sh'));
    const chunks: string[] = [];
    const exits: Array<[string, number]> = [];
    adapter.onData((sessionId, chunk) => chunks.push(chunk));
    adapter.onExit((sessionId, exitCode) => exits.push([sessionId, exitCode]));

    await adapter.spawn('sess-3', process.cwd(), {
      cols: 80,
      rows: 24,
      conversation: { mode: 'resume', claudeSessionId: 'c-3' },
    });

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

  it("with mode 'start', never attempts a resume — no failed-attempt flash, no retry, starts clean immediately", async () => {
    const adapter = new NodePtySessionAdapter(stub('stub-no-conversation.sh'));
    const chunks: string[] = [];
    const exits: Array<[string, number]> = [];
    adapter.onData((sessionId, chunk) => chunks.push(chunk));
    adapter.onExit((sessionId, exitCode) => exits.push([sessionId, exitCode]));

    await adapter.spawn('sess-4', process.cwd(), {
      cols: 80,
      rows: 24,
      conversation: { mode: 'start', claudeSessionId: 'c-4' },
    });

    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('READY');
    });
    expect(chunks.join('')).not.toContain('No conversation found');
    expect(exits).toEqual([]);
  });

  it("passes --session-id <uuid> for mode 'start', so the CLI writes the transcript at a path known before it runs", async () => {
    const adapter = new NodePtySessionAdapter(stub('stub-echo-args.sh'));
    const chunks: string[] = [];
    adapter.onData((sessionId, chunk) => chunks.push(chunk));

    await adapter.spawn('sess-5', process.cwd(), {
      cols: 80,
      rows: 24,
      conversation: { mode: 'start', claudeSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
    });

    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('ARGV:--session-id aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    });
  });

  it("passes --resume <uuid> for mode 'resume', reattaching to that exact conversation rather than the cwd's most recent one", async () => {
    const adapter = new NodePtySessionAdapter(stub('stub-echo-args.sh'));
    const chunks: string[] = [];
    adapter.onData((sessionId, chunk) => chunks.push(chunk));

    await adapter.spawn('sess-6', process.cwd(), {
      cols: 80,
      rows: 24,
      conversation: { mode: 'resume', claudeSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
    });

    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('ARGV:--resume aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    });
  });
});
