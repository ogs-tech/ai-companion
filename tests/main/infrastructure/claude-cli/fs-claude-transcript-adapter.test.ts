import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsClaudeTranscriptAdapter } from '../../../../src/main/infrastructure/claude-cli/fs-claude-transcript-adapter.js';

let work: string;
let projectsDir: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'ai-companion-transcripts-'));
  projectsDir = join(work, 'projects');
  await mkdir(projectsDir, { recursive: true });
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

/** Writes a transcript as JSONL, exactly as the CLI appends it. */
async function transcript(slug: string, claudeSessionId: string, lines: readonly unknown[]): Promise<string> {
  const dir = join(projectsDir, slug);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${claudeSessionId}.jsonl`);
  await writeFile(filePath, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8');
  return filePath;
}

const userLine = (cwd: string): unknown => ({
  type: 'user',
  cwd,
  gitBranch: 'main',
  timestamp: '2026-09-10T10:00:00.000Z',
  message: { role: 'user', content: 'hi' },
});

const costState = (overrides: Record<string, unknown> = {}): unknown => ({
  type: 'cost-state',
  sessionId: 'ignored',
  totalCostUSD: 4.4025825,
  totalDuration: 1_193_607,
  startTime: Date.parse('2026-09-10T10:00:00.000Z'),
  modelUsage: {
    'claude-opus-5[1m]': {
      inputTokens: 192,
      outputTokens: 30_213,
      cacheReadInputTokens: 4_539_109,
      cacheCreationInputTokens: 137_578,
      costUSD: 4.4016195,
    },
    'claude-haiku-4-5-20251001': {
      inputTokens: 913,
      outputTokens: 10,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0.000963,
    },
  },
  hasUnknownModelCost: false,
  ...overrides,
});

const adapter = (): FsClaudeTranscriptAdapter => new FsClaudeTranscriptAdapter(projectsDir);

describe('FsClaudeTranscriptAdapter', () => {
  describe('listRefs', () => {
    it('returns one ref per transcript across every project folder', async () => {
      await transcript('-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', [userLine('/Users/me/alpha')]);
      await transcript('-Users-me-beta', 'aaaaaaaa-0000-4000-8000-000000000002', [userLine('/Users/me/beta')]);
      await transcript('-Users-me-beta', 'aaaaaaaa-0000-4000-8000-000000000003', [userLine('/Users/me/beta')]);

      const refs = await adapter().listRefs();

      expect(refs).toHaveLength(3);
      expect(refs.map((ref) => ref.claudeSessionId).sort()).toEqual([
        'aaaaaaaa-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000003',
      ]);
    });

    it('reads cwd from inside the file, so a directory whose own name contains a hyphen survives the round trip', async () => {
      // The folder name is the cwd with separators replaced by hyphens, which
      // cannot be reversed: `/Users/me/ai-companion` and `/Users/me/ai/companion`
      // produce the same slug.
      await transcript('-Users-me-ai-companion', 'aaaaaaaa-0000-4000-8000-000000000001', [
        userLine('/Users/me/ai-companion'),
      ]);

      const [ref] = await adapter().listRefs();

      expect(ref?.cwd).toBe('/Users/me/ai-companion');
    });

    it('finds cwd even when the first lines of the file do not carry one', async () => {
      await transcript('-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', [
        { type: 'mode', mode: 'normal' },
        { type: 'bridge-session' },
        userLine('/Users/me/alpha'),
      ]);

      const [ref] = await adapter().listRefs();

      expect(ref?.cwd).toBe('/Users/me/alpha');
    });

    it('ignores subagent transcripts nested under a session folder — they are not sessions and carry no cost of their own', async () => {
      await transcript('-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', [userLine('/Users/me/alpha')]);
      const nested = join(projectsDir, '-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', 'subagents');
      await mkdir(nested, { recursive: true });
      await writeFile(join(nested, 'agent-abc.jsonl'), JSON.stringify(userLine('/Users/me/alpha')), 'utf8');

      const refs = await adapter().listRefs();

      expect(refs).toHaveLength(1);
      expect(refs[0]?.claudeSessionId).toBe('aaaaaaaa-0000-4000-8000-000000000001');
    });

    it('skips a transcript with no cwd anywhere rather than guessing one from the folder name', async () => {
      await transcript('-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', [{ type: 'mode', mode: 'normal' }]);

      expect(await adapter().listRefs()).toEqual([]);
    });

    it('tolerates an empty transcript', async () => {
      await mkdir(join(projectsDir, '-Users-me-alpha'), { recursive: true });
      await writeFile(join(projectsDir, '-Users-me-alpha', 'empty.jsonl'), '', 'utf8');

      expect(await adapter().listRefs()).toEqual([]);
    });

    it('skips malformed lines instead of failing the whole listing — a half-written line is normal while a session is live', async () => {
      const dir = join(projectsDir, '-Users-me-alpha');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'),
        ['{ not json at all', JSON.stringify(userLine('/Users/me/alpha')), '{"truncated":'].join('\n'),
        'utf8',
      );

      const [ref] = await adapter().listRefs();

      expect(ref?.cwd).toBe('/Users/me/alpha');
    });

    it('returns nothing when the CLI has never run on this machine', async () => {
      const missing = new FsClaudeTranscriptAdapter(join(work, 'nope'));

      expect(await missing.listRefs()).toEqual([]);
    });

    it('carries the stat values a cache needs to tell a changed transcript from an unchanged one', async () => {
      await transcript('-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', [userLine('/Users/me/alpha')]);

      const [ref] = await adapter().listRefs();

      expect(ref?.sizeBytes).toBeGreaterThan(0);
      expect(ref?.mtimeMs).toBeGreaterThan(0);
      expect(ref?.modifiedAt).toBe(new Date(ref!.mtimeMs).toISOString());
    });
  });

  describe('readUsage', () => {
    it("takes the CLI's own cost and per-model tokens rather than reconstructing them", async () => {
      await transcript('-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', [
        userLine('/Users/me/alpha'),
        costState(),
      ]);
      const [ref] = await adapter().listRefs();

      const usage = await adapter().readUsage(ref!);

      expect(usage.reportedCostUsd).toBeCloseTo(4.4025825, 6);
      expect(usage.durationMs).toBe(1_193_607);
      expect(usage.startedAt).toBe('2026-09-10T10:00:00.000Z');
      expect(usage.models).toEqual(
        expect.arrayContaining([
          {
            model: 'claude-opus-5[1m]',
            inputTokens: 192,
            outputTokens: 30_213,
            cacheCreationTokens: 137_578,
            cacheReadTokens: 4_539_109,
            reportedCostUsd: 4.4016195,
          },
        ]),
      );
    });

    it("refuses the CLI's total when the CLI itself flags part of it as unpriced, rather than reporting a number that is quietly too low", async () => {
      await transcript('-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', [
        userLine('/Users/me/alpha'),
        costState({ hasUnknownModelCost: true }),
      ]);
      const [ref] = await adapter().listRefs();

      const usage = await adapter().readUsage(ref!);

      expect(usage.reportedCostUsd).toBeNull();
      // The tokens are still there for the price table to work from.
      expect(usage.models).toHaveLength(2);
    });

    it('reads the cost from the end of the file without touching the bulk in the middle', async () => {
      // A megabyte of assistant chatter between the head and the cost line —
      // if the adapter needed the middle, this would be the slow path.
      const filler = Array.from({ length: 400 }, () => ({
        type: 'assistant',
        cwd: '/Users/me/alpha',
        timestamp: '2026-09-10T10:00:00.000Z',
        message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 }, content: 'x'.repeat(3000) },
      }));
      await transcript('-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', [
        userLine('/Users/me/alpha'),
        ...filler,
        costState(),
      ]);
      const [ref] = await adapter().listRefs();
      expect(ref!.sizeBytes).toBeGreaterThan(1_000_000);

      const usage = await adapter().readUsage(ref!);

      // Straight from `cost-state`, not the 400 assistant lines it skipped over.
      expect(usage.reportedCostUsd).toBeCloseTo(4.4025825, 6);
      expect(usage.models.map((m) => m.model).sort()).toEqual(['claude-haiku-4-5-20251001', 'claude-opus-5[1m]']);
    });

    it('sums the assistant lines when the transcript predates the CLI recording its own cost', async () => {
      await transcript('-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', [
        userLine('/Users/me/alpha'),
        {
          type: 'assistant',
          timestamp: '2026-09-10T10:00:00.000Z',
          message: {
            model: 'claude-opus-5',
            usage: {
              input_tokens: 2,
              output_tokens: 456,
              cache_creation_input_tokens: 25_216,
              cache_read_input_tokens: 34_799,
            },
          },
        },
        {
          type: 'assistant',
          timestamp: '2026-09-10T10:05:00.000Z',
          message: {
            model: 'claude-opus-5',
            usage: { input_tokens: 3, output_tokens: 44, cache_creation_input_tokens: 0, cache_read_input_tokens: 10 },
          },
        },
      ]);
      const [ref] = await adapter().listRefs();

      const usage = await adapter().readUsage(ref!);

      expect(usage.reportedCostUsd).toBeNull();
      expect(usage.models).toEqual([
        {
          model: 'claude-opus-5',
          inputTokens: 5,
          outputTokens: 500,
          cacheCreationTokens: 25_216,
          cacheReadTokens: 34_809,
          reportedCostUsd: null,
        },
      ]);
      expect(usage.startedAt).toBe('2026-09-10T10:00:00.000Z');
      expect(usage.endedAt).toBe('2026-09-10T10:05:00.000Z');
      expect(usage.durationMs).toBe(5 * 60 * 1000);
    });

    it('reports no models for a conversation that never reached the API', async () => {
      await transcript('-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', [userLine('/Users/me/alpha')]);
      const [ref] = await adapter().listRefs();

      const usage = await adapter().readUsage(ref!);

      expect(usage.models).toEqual([]);
      expect(usage.reportedCostUsd).toBeNull();
    });

    describe('title', () => {
      const withTitleLines = async (...lines: unknown[]): Promise<string | null> => {
        await transcript('-Users-me-alpha', 'aaaaaaaa-0000-4000-8000-000000000001', [
          userLine('/Users/me/alpha'),
          ...lines,
          costState(),
        ]);
        const [ref] = await adapter().listRefs();
        return (await adapter().readUsage(ref!)).title;
      };

      it("prefers the user's own title over the generated one", async () => {
        expect(
          await withTitleLines({ type: 'ai-title', aiTitle: 'Generated' }, { type: 'custom-title', customTitle: 'Mine' }),
        ).toBe('Mine');
      });

      it('falls back to the generated title', async () => {
        expect(await withTitleLines({ type: 'ai-title', aiTitle: 'Sessões com dash e filtros' })).toBe(
          'Sessões com dash e filtros',
        );
      });

      it('takes the latest generated title when the CLI has rewritten it', async () => {
        expect(
          await withTitleLines({ type: 'ai-title', aiTitle: 'First guess' }, { type: 'ai-title', aiTitle: 'Better name' }),
        ).toBe('Better name');
      });

      it('falls back to the opening line of the last prompt, clipped to fit a row', async () => {
        const prompt = `${'a'.repeat(200)}\nsecond line`;

        const title = await withTitleLines({ type: 'last-prompt', lastPrompt: prompt });

        expect(title).toBe(`${'a'.repeat(80)}…`);
      });

      it('is null when the conversation never got a title or a prompt', async () => {
        expect(await withTitleLines()).toBeNull();
      });
    });
  });
});
