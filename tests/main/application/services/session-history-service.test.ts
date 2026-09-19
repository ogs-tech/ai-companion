import { describe, it, expect } from 'vitest';
import { SessionHistoryService } from '../../../../src/main/application/services/session-history-service.js';
import type {
  SessionTranscriptPort,
  TranscriptRef,
  TranscriptUsage,
} from '../../../../src/main/application/ports/session-transcript-port.js';
import { getDefaults, type Settings } from '../../../../src/shared/settings.js';

interface FakeTranscript {
  ref: TranscriptRef;
  usage: TranscriptUsage;
}

/** Records what it was asked to read, so a test can prove a reading was reused rather than repeated. */
class FakeTranscriptPort implements SessionTranscriptPort {
  readUsageCalls: string[] = [];

  constructor(public transcripts: FakeTranscript[]) {}

  async listRefs(): Promise<TranscriptRef[]> {
    return this.transcripts.map((t) => t.ref);
  }

  async readUsage(ref: TranscriptRef): Promise<TranscriptUsage> {
    this.readUsageCalls.push(ref.claudeSessionId);
    const found = this.transcripts.find((t) => t.ref.filePath === ref.filePath);
    if (!found) throw new Error(`no such transcript: ${ref.filePath}`);
    return found.usage;
  }
}

let seq = 0;
function transcript(overrides: {
  id?: string;
  cwd?: string;
  mtimeMs?: number;
  title?: string | null;
  model?: string;
  reportedCostUsd?: number | null;
  endedAt?: string;
  outputTokens?: number;
}): FakeTranscript {
  seq += 1;
  const id = overrides.id ?? `session-${seq}`;
  const mtimeMs = overrides.mtimeMs ?? 1_000_000 + seq;
  const endedAt = overrides.endedAt ?? new Date(mtimeMs).toISOString();
  const model = overrides.model ?? 'claude-opus-5';
  return {
    ref: {
      claudeSessionId: id,
      filePath: `/transcripts/${id}.jsonl`,
      cwd: overrides.cwd ?? '/repos/acme',
      modifiedAt: new Date(mtimeMs).toISOString(),
      mtimeMs,
      sizeBytes: 100,
    },
    usage: {
      title: overrides.title === undefined ? `Session ${id}` : overrides.title,
      models: [
        {
          model,
          inputTokens: 1000,
          outputTokens: overrides.outputTokens ?? 500,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          reportedCostUsd: null,
        },
      ],
      reportedCostUsd: overrides.reportedCostUsd === undefined ? 1 : overrides.reportedCostUsd,
      startedAt: endedAt,
      endedAt,
      durationMs: 1000,
    },
  };
}

const settingsService = (settings?: Partial<Settings>) => ({
  load: async (): Promise<Settings | null> => ({ ...getDefaults(), ...settings }),
  getDefaults,
});

const scopeDeps = {
  workspaceService: {
    get: async (id: string) => ({ id, name: 'W', rootPath: '/repos', isDefault: false, createdAt: '' }),
  },
  projectService: {
    get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }),
    findOrCreateByPath: async (path: string) => ({ id: `p:${path}`, name: 'x', path, createdAt: '' }),
  },
};

const setup = (transcripts: FakeTranscript[], settings?: Partial<Settings>) => {
  const port = new FakeTranscriptPort(transcripts);
  const service = new SessionHistoryService(port, settingsService(settings), scopeDeps);
  return { service, port };
};

const ALL = { kind: 'all' } as const;
const PROJECT = { kind: 'project', projectId: 'p1' } as const;

describe('SessionHistoryService', () => {
  describe('scope', () => {
    it('keeps only conversations that ran in the project, or anywhere below it', async () => {
      const { service } = setup([
        transcript({ id: 'inside', cwd: '/repos/acme' }),
        transcript({ id: 'nested', cwd: '/repos/acme/packages/ui' }),
        transcript({ id: 'elsewhere', cwd: '/repos/other' }),
      ]);

      const page = await service.list({ scope: PROJECT });

      expect(page.entries.map((e) => e.claudeSessionId).sort()).toEqual(['inside', 'nested']);
    });

    it('does not mistake a sibling directory that merely shares a prefix for a child of the project', async () => {
      const { service } = setup([
        transcript({ id: 'inside', cwd: '/repos/acme' }),
        transcript({ id: 'sibling', cwd: '/repos/acme-archive' }),
      ]);

      const page = await service.list({ scope: PROJECT });

      expect(page.entries.map((e) => e.claudeSessionId)).toEqual(['inside']);
    });

    it("covers every project under the workspace's root", async () => {
      const { service } = setup([
        transcript({ id: 'a', cwd: '/repos/acme' }),
        transcript({ id: 'b', cwd: '/repos/other' }),
        transcript({ id: 'c', cwd: '/elsewhere' }),
      ]);

      const page = await service.list({ scope: { kind: 'workspace', workspaceId: 'w1' } });

      expect(page.entries.map((e) => e.claudeSessionId).sort()).toEqual(['a', 'b']);
    });

    it('takes everything on the machine when asked for everything', async () => {
      const { service } = setup([
        transcript({ id: 'a', cwd: '/repos/acme' }),
        transcript({ id: 'b', cwd: '/somewhere/else' }),
      ]);

      expect((await service.list({ scope: ALL })).total).toBe(2);
    });
  });

  describe('ordering and paging', () => {
    it('lists the most recently touched conversation first', async () => {
      const { service } = setup([
        transcript({ id: 'old', mtimeMs: 1000 }),
        transcript({ id: 'newest', mtimeMs: 3000 }),
        transcript({ id: 'middle', mtimeMs: 2000 }),
      ]);

      const page = await service.list({ scope: ALL });

      expect(page.entries.map((e) => e.claudeSessionId)).toEqual(['newest', 'middle', 'old']);
    });

    it('pages ten at a time by default and hands back a cursor for the rest', async () => {
      const { service } = setup(Array.from({ length: 25 }, (_, i) => transcript({ id: `s${i}`, mtimeMs: 1000 + i })));

      const first = await service.list({ scope: ALL });

      expect(first.entries).toHaveLength(10);
      expect(first.total).toBe(25);
      expect(first.nextCursor).not.toBeNull();
    });

    it('resumes exactly after the last row of the previous page, with no gap and no repeat', async () => {
      const { service } = setup(Array.from({ length: 25 }, (_, i) => transcript({ id: `s${i}`, mtimeMs: 1000 + i })));

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<typeof service.list>> = await service.list({
          scope: ALL,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.entries.map((e) => e.claudeSessionId));
        cursor = page.nextCursor;
      } while (cursor);

      expect(seen).toHaveLength(25);
      expect(new Set(seen).size).toBe(25);
    });

    it('closes the cursor at the end of the list rather than offering an empty page', async () => {
      const { service } = setup([transcript({ id: 'only' })]);

      expect((await service.list({ scope: ALL })).nextCursor).toBeNull();
    });

    it('honours an explicit page size', async () => {
      const { service } = setup(Array.from({ length: 5 }, (_, i) => transcript({ id: `s${i}` })));

      expect((await service.list({ scope: ALL, limit: 2 })).entries).toHaveLength(2);
    });

    it('skips no row when a live session writes to its transcript and jumps to the top mid-scroll', async () => {
      // An offset-based pager would re-serve the row that the jump pushed down
      // into the slot the cursor pointed at; an anchored one cannot.
      const transcripts = Array.from({ length: 6 }, (_, i) => transcript({ id: `s${i}`, mtimeMs: 1000 + i }));
      const { service, port } = setup(transcripts);
      const firstPage = await service.list({ scope: ALL, limit: 3 });
      expect(firstPage.entries.map((e) => e.claudeSessionId)).toEqual(['s5', 's4', 's3']);

      // s0, the oldest and still unseen, is written to and becomes the newest.
      const live = port.transcripts.find((t) => t.ref.claudeSessionId === 's0')!;
      live.ref.mtimeMs = 9999;
      live.ref.modifiedAt = new Date(9999).toISOString();

      const secondPage = await service.list({ scope: ALL, limit: 3, cursor: firstPage.nextCursor! });

      expect(secondPage.entries.map((e) => e.claudeSessionId)).toEqual(['s2', 's1']);
      // s0 moved above the cursor, so it is not served again here — and no
      // row that was below the cursor was skipped.
      expect(secondPage.entries.map((e) => e.claudeSessionId)).not.toContain('s0');
    });

    it('rejects a cursor that is not one it issued', async () => {
      const { service } = setup([transcript({})]);

      await expect(service.list({ scope: ALL, cursor: 'not-a-cursor' })).rejects.toMatchObject({ kind: 'validation' });
    });
  });

  describe('readings', () => {
    it('reads each transcript once and reuses it, so opening the panel does not re-read the disk per query', async () => {
      const { service, port } = setup([transcript({ id: 'a' }), transcript({ id: 'b' })]);

      await service.list({ scope: ALL });
      await service.stats({ scope: ALL });

      expect(port.readUsageCalls).toEqual(['a', 'b']);
    });

    it('re-reads a transcript that has grown since it was last read', async () => {
      const { service, port } = setup([transcript({ id: 'a' })]);
      await service.list({ scope: ALL });

      port.transcripts[0]!.ref.sizeBytes += 1;
      await service.list({ scope: ALL });

      expect(port.readUsageCalls).toEqual(['a', 'a']);
    });

    it('re-reads a transcript whose mtime moved even at the same size', async () => {
      const { service, port } = setup([transcript({ id: 'a' })]);
      await service.list({ scope: ALL });

      port.transcripts[0]!.ref.mtimeMs += 1;
      await service.list({ scope: ALL });

      expect(port.readUsageCalls).toEqual(['a', 'a']);
    });

    it('reads each transcript once even when list() and stats() are called concurrently, not just sequentially', async () => {
      // The renderer fires `useSessionHistory` and `useSessionHistoryStats`
      // together on mount — the cache above only helps a *second* call that
      // starts after the first already finished. A caller that starts while
      // the first read is still in flight must reuse that same read, or the
      // panel does every transcript's disk read twice on first open.
      const { service, port } = setup([transcript({ id: 'a' }), transcript({ id: 'b' })]);

      await Promise.all([service.list({ scope: ALL }), service.stats({ scope: ALL })]);

      expect(port.readUsageCalls.filter((id) => id === 'a')).toHaveLength(1);
      expect(port.readUsageCalls.filter((id) => id === 'b')).toHaveLength(1);
    });

    it('reads every transcript in scope concurrently, not one at a time, so a large history does not scale linearly with disk round trips', async () => {
      // At 178 real transcripts, a one-at-a-time loop pays a full disk round
      // trip per file in sequence before the panel can show anything —
      // that's the wait a person mistakes for "stuck until scrolling
      // finishes". Reading them together turns N round trips into one.
      const transcripts = Array.from({ length: 5 }, (_, i) => transcript({ id: `s${i}` }));
      const { service, port } = setup(transcripts);

      const started: string[] = [];
      let releaseReads: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        releaseReads = resolve;
      });
      const originalReadUsage = port.readUsage.bind(port);
      port.readUsage = async (ref) => {
        started.push(ref.claudeSessionId); // recorded before the gate, unlike readUsageCalls below
        await gate; // every read blocks here until released together
        return originalReadUsage(ref);
      };

      const pending = service.list({ scope: ALL });
      // Flush the microtask queue (scope/rate-override lookups, cache checks)
      // so every read has had the chance to start before any of them can finish.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(started).toHaveLength(5);

      releaseReads!();
      await pending;
    });
  });

  describe('entries', () => {
    it("labels a cost the CLI recorded as read, not estimated", async () => {
      const { service } = setup([transcript({ reportedCostUsd: 4.4 })]);

      const [entry] = (await service.list({ scope: ALL })).entries;

      expect(entry?.costUsd).toBe(4.4);
      expect(entry?.costSource).toBe('reported');
    });

    it('labels a cost it had to reconstruct as estimated', async () => {
      const { service } = setup([transcript({ reportedCostUsd: null })]);

      const [entry] = (await service.list({ scope: ALL })).entries;

      expect(entry?.costSource).toBe('estimated');
      expect(entry?.costUsd).toBeGreaterThan(0);
    });

    it('reports no cost at all for an unpriced model rather than a number it cannot stand behind', async () => {
      const { service } = setup([transcript({ reportedCostUsd: null, model: '<synthetic>' })]);

      const [entry] = (await service.list({ scope: ALL })).entries;

      expect(entry?.costUsd).toBeNull();
      expect(entry?.costSource).toBe('unknown');
    });

    it('applies a per-model rate override from Settings when it has to estimate', async () => {
      const { service } = setup([transcript({ reportedCostUsd: null, model: 'house-model', outputTokens: 1_000_000 })], {
        pricing: { 'house-model': { input: 0, output: 3 } },
      });

      const [entry] = (await service.list({ scope: ALL })).entries;

      expect(entry?.costUsd).toBeCloseTo(3, 6);
    });
  });

  describe('filters', () => {
    it('narrows to the chosen models', async () => {
      const { service } = setup([
        transcript({ id: 'opus', model: 'claude-opus-5' }),
        transcript({ id: 'haiku', model: 'claude-haiku-4-5' }),
      ]);

      const page = await service.list({ scope: ALL, filters: { models: ['claude-haiku-4-5'] } });

      expect(page.entries.map((e) => e.claudeSessionId)).toEqual(['haiku']);
    });

    it('searches the title and the directory, case-insensitively', async () => {
      const { service } = setup([
        transcript({ id: 'a', title: 'Refatorar o adapter' }),
        transcript({ id: 'b', title: 'Outra coisa', cwd: '/repos/acme' }),
      ]);

      expect((await service.list({ scope: ALL, filters: { search: 'ADAPTER' } })).entries).toHaveLength(1);
    });

    it('bounds the list by date, inclusively at both ends', async () => {
      const { service } = setup([
        transcript({ id: 'before', endedAt: '2026-09-01T12:00:00.000Z' }),
        transcript({ id: 'inside', endedAt: '2026-09-10T12:00:00.000Z' }),
        transcript({ id: 'after', endedAt: '2026-09-20T12:00:00.000Z' }),
      ]);

      const page = await service.list({
        scope: ALL,
        filters: { from: '2026-09-10T00:00:00.000Z', to: '2026-09-10T23:59:59.000Z' },
      });

      expect(page.entries.map((e) => e.claudeSessionId)).toEqual(['inside']);
    });
  });

  describe('stats', () => {
    it('totals what it could price and counts separately what it could not, rather than folding a blank into the sum as zero', async () => {
      const { service } = setup([
        transcript({ id: 'a', reportedCostUsd: 2 }),
        transcript({ id: 'b', reportedCostUsd: 3 }),
        transcript({ id: 'c', reportedCostUsd: null, model: '<synthetic>' }),
      ]);

      const stats = await service.stats({ scope: ALL });

      expect(stats.totalCostUsd).toBeCloseTo(5, 6);
      expect(stats.unpricedCount).toBe(1);
      expect(stats.sessionCount).toBe(3);
    });

    it('buckets spend by day, oldest first, so a chart reads left to right', async () => {
      const { service } = setup([
        transcript({ id: 'a', endedAt: '2026-09-10T12:00:00.000Z', reportedCostUsd: 1 }),
        transcript({ id: 'b', endedAt: '2026-09-10T18:00:00.000Z', reportedCostUsd: 2 }),
        transcript({ id: 'c', endedAt: '2026-09-11T09:00:00.000Z', reportedCostUsd: 4 }),
      ]);

      const stats = await service.stats({ scope: ALL });

      expect(stats.perDay).toHaveLength(2);
      expect(stats.perDay[0]?.costUsd).toBeCloseTo(3, 6);
      expect(stats.perDay[0]?.sessionCount).toBe(2);
      expect(stats.perDay[1]?.costUsd).toBeCloseTo(4, 6);
      expect(stats.perDay.map((d) => d.date)).toEqual([...stats.perDay.map((d) => d.date)].sort());
    });

    it('lists the models in scope so the filter pills can be built from real data', async () => {
      const { service } = setup([
        transcript({ model: 'claude-opus-5' }),
        transcript({ model: 'claude-haiku-4-5' }),
        transcript({ model: 'claude-opus-5' }),
      ]);

      expect((await service.stats({ scope: ALL })).models).toEqual(['claude-haiku-4-5', 'claude-opus-5']);
    });

    it('honours the same filters the list does', async () => {
      const { service } = setup([
        transcript({ id: 'opus', model: 'claude-opus-5', reportedCostUsd: 10 }),
        transcript({ id: 'haiku', model: 'claude-haiku-4-5', reportedCostUsd: 1 }),
      ]);

      const stats = await service.stats({ scope: ALL, filters: { models: ['claude-haiku-4-5'] } });

      expect(stats.totalCostUsd).toBeCloseTo(1, 6);
      expect(stats.sessionCount).toBe(1);
    });

    it('is an honest zero when nothing is in scope', async () => {
      const { service } = setup([]);

      const stats = await service.stats({ scope: ALL });

      expect(stats).toEqual({ totalCostUsd: 0, unpricedCount: 0, sessionCount: 0, perDay: [], models: [] });
    });
  });

  describe('find', () => {
    it('locates one conversation by id', async () => {
      const { service } = setup([transcript({ id: 'wanted' }), transcript({ id: 'other' })]);

      expect((await service.find('wanted'))?.claudeSessionId).toBe('wanted');
    });

    it('is undefined for a conversation with no transcript', async () => {
      const { service } = setup([transcript({ id: 'a' })]);

      expect(await service.find('nope')).toBeUndefined();
    });
  });
});
