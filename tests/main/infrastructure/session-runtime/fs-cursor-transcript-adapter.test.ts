import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsCursorTranscriptAdapter } from '../../../../src/main/infrastructure/session-runtime/fs-cursor-transcript-adapter.js';

let dir: string;

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
    const refs = await new FsCursorTranscriptAdapter(dir).listRefs();
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
    expect(await new FsCursorTranscriptAdapter(dir).listRefs()).toEqual([]);
  });

  it('returns nothing when Cursor never ran on this machine', async () => {
    expect(await new FsCursorTranscriptAdapter(join(dir, 'missing')).listRefs()).toEqual([]);
  });

  it('reports the title and dates, and says the chat is unpriced rather than free', async () => {
    await chat('h1', 'chat-a', meta());
    const adapter = new FsCursorTranscriptAdapter(dir);
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
});
