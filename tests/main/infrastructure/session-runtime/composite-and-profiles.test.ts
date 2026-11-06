import { describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompositeTranscriptAdapter } from '../../../../src/main/infrastructure/session-runtime/composite-transcript-adapter.js';
import { CLAUDE_PROFILE, CURSOR_PROFILE } from '../../../../src/main/infrastructure/session-runtime/cli-profiles.js';
import { isExecutableAvailable } from '../../../../src/main/infrastructure/session-runtime/find-executable.js';
import type { SessionTranscriptPort, TranscriptRef } from '../../../../src/main/application/ports/session-transcript-port.js';

const ref = (harness: 'claude' | 'cursor', id: string): TranscriptRef => ({
  harness, conversationId: id, filePath: `/t/${id}`, cwd: '/r', modifiedAt: '', mtimeMs: 1, sizeBytes: 1,
});
const usage = (title: string) => ({ title, models: [], reportedCostUsd: null, startedAt: '', endedAt: '', durationMs: null });

describe('CompositeTranscriptAdapter', () => {
  const claude: SessionTranscriptPort = { readLiveMetrics: async () => null,
    listRefs: async () => [ref('claude', 'a')], readUsage: vi.fn(async () => usage('claude')) };
  const cursor: SessionTranscriptPort = { readLiveMetrics: async () => null,
    listRefs: async () => [ref('cursor', 'b')], readUsage: vi.fn(async () => usage('cursor')) };
  const composite = new CompositeTranscriptAdapter({ claude, cursor });

  it('lists the conversations of every harness together', async () => {
    expect((await composite.listRefs()).map((r) => r.conversationId)).toEqual(['a', 'b']);
  });

  it('reads each conversation with the harness that wrote it', async () => {
    expect((await composite.readUsage(ref('cursor', 'b'))).title).toBe('cursor');
    expect((await composite.readUsage(ref('claude', 'a'))).title).toBe('claude');
  });

  it('rejects a conversation of a harness it has no reader for', async () => {
    await expect(new CompositeTranscriptAdapter({ claude }).readUsage(ref('cursor', 'b'))).rejects.toThrow(/cursor/);
  });
});

describe('CLI profiles', () => {
  it('Claude names the conversation up front and can recover a missing one', async () => {
    expect(CLAUDE_PROFILE.startArgs('id')).toEqual(['--session-id', 'id']);
    expect(CLAUDE_PROFILE.resumeArgs('id')).toEqual(['--resume', 'id']);
    expect(CLAUDE_PROFILE.missingConversationMarker).not.toBeNull();
    expect(await CLAUDE_PROFILE.newConversationId({ bin: 'claude', cwd: '/', env: {} })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('Cursor starts and resumes the same way — the chat already exists after create-chat', () => {
    expect(CURSOR_PROFILE.startArgs('id')).toEqual(['--resume', 'id']);
    expect(CURSOR_PROFILE.resumeArgs('id')).toEqual(['--resume', 'id']);
    expect(CURSOR_PROFILE.missingConversationMarker).toBeNull();
    expect(CURSOR_PROFILE.supportsMcpConfig).toBe(false);
  });

  it('Cursor takes the chat id from what create-chat prints', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fake-cursor-'));
    try {
      const bin = join(dir, 'cursor-agent');
      await writeFile(bin, '#!/bin/sh\necho "chat-123"\n');
      await chmod(bin, 0o755);
      expect(await CURSOR_PROFILE.newConversationId({ bin, cwd: dir, env: process.env })).toBe('chat-123');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Cursor fails when create-chat prints nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fake-cursor-'));
    try {
      const bin = join(dir, 'cursor-agent');
      await writeFile(bin, '#!/bin/sh\nexit 0\n');
      await chmod(bin, 0o755);
      await expect(CURSOR_PROFILE.newConversationId({ bin, cwd: dir, env: process.env })).rejects.toThrow(/no chat id/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('isExecutableAvailable', () => {
  it('finds a binary in an extra directory outside PATH, and not one that is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bin-'));
    try {
      const bin = join(dir, 'tool-xyz');
      await writeFile(bin, '#!/bin/sh\n');
      await chmod(bin, 0o755);
      expect(await isExecutableAvailable('tool-xyz', [dir], '/nonexistent')).toBe(true);
      expect(await isExecutableAvailable('tool-xyz', [], '/nonexistent')).toBe(false);
      expect(await isExecutableAvailable(bin)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
