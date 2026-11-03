import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CursorChatStorePort } from '../../../../src/main/application/ports/cursor-chat-store-port.js';
import { FsCursorTranscriptAdapter } from '../../../../src/main/infrastructure/session-runtime/fs-cursor-transcript-adapter.js';

let dir: string;

const storeOf = (messages: string[] = []): CursorChatStorePort => ({ readMessages: async () => messages });
const adapterOf = (messages: string[] = [], root: string = dir): FsCursorTranscriptAdapter =>
  new FsCursorTranscriptAdapter(root, storeOf(messages));

const chat = async (hash: string, id: string, meta: unknown | string): Promise<void> => {
  await mkdir(join(dir, hash, id), { recursive: true });
  await writeFile(join(dir, hash, id, 'meta.json'), typeof meta === 'string' ? meta : JSON.stringify(meta));
};

const meta = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  createdAtMs: 1_000,
  updatedAtMs: 5_000,
  title: 'Criar Readme',
  hasConversation: true,
  cwd: '/repos/acme',
  ...overrides,
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cursor-chats-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FsCursorTranscriptAdapter', () => {
  it('lists each chat as a cursor ref dated by its own updatedAtMs', async () => {
    await chat('h1', 'chat-a', meta());
    const refs = await adapterOf().listRefs();
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      harness: 'cursor',
      conversationId: 'chat-a',
      cwd: '/repos/acme',
      mtimeMs: 5_000,
      modifiedAt: new Date(5_000).toISOString(),
    });
  });

  it('skips chats that were created but never used, and meta files it cannot read', async () => {
    await chat('h1', 'empty', meta({ hasConversation: false }));
    await chat('h1', 'broken', '{ not json');
    await chat('h1', 'no-cwd', meta({ cwd: undefined }));
    await mkdir(join(dir, 'h1', 'no-meta'), { recursive: true });
    expect(await adapterOf().listRefs()).toEqual([]);
  });

  it('returns nothing when Cursor never ran on this machine', async () => {
    expect(await adapterOf([], join(dir, 'missing')).listRefs()).toEqual([]);
  });

  it('reports the title and dates, and says the chat is unpriced rather than free', async () => {
    await chat('h1', 'chat-a', meta());
    const adapter = adapterOf();
    const [ref] = await adapter.listRefs();
    const usage = await adapter.readUsage(ref!);
    expect(usage).toMatchObject({
      title: 'Criar Readme',
      unpriced: true,
      models: [],
      reportedCostUsd: null,
      startedAt: new Date(1_000).toISOString(),
      endedAt: new Date(5_000).toISOString(),
      durationMs: null,
    });
  });

  it('estimates usage from the chat messages when the store has a known model', async () => {
    await chat('h1', 'chat-a', meta());
    const messages = [
      JSON.stringify({ role: 'user', content: 'a'.repeat(40) }),
      JSON.stringify({
        role: 'assistant',
        content: [{ type: 'text', text: 'b'.repeat(40), providerOptions: { cursor: { modelName: 'claude-opus-4-7-thinking-xhigh' } } }],
      }),
    ];
    const adapter = adapterOf(messages);
    const [ref] = await adapter.listRefs();
    const usage = await adapter.readUsage(ref!);
    expect(usage.unpriced).toBeUndefined();
    expect(usage.models).toEqual([
      { model: 'claude-opus-4-7', inputTokens: 10, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0, reportedCostUsd: null },
    ]);
  });
});
