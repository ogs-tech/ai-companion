import { describe, it, expect } from 'vitest';
import {
  BUNDLED_MODEL_RATES,
  estimateModelCost,
  normalizeModelId,
  primaryModel,
  rateFor,
  resolveCostUsd,
} from '../../../../src/main/application/pricing/model-pricing.js';
import type { TranscriptModelUsage, TranscriptUsage } from '../../../../src/main/application/ports/session-transcript-port.js';

const modelUsage = (overrides: Partial<TranscriptModelUsage> = {}): TranscriptModelUsage => ({
  model: 'claude-opus-5',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reportedCostUsd: null,
  ...overrides,
});

const usage = (overrides: Partial<TranscriptUsage> = {}): TranscriptUsage => ({
  title: null,
  models: [],
  reportedCostUsd: null,
  startedAt: '2026-09-10T10:00:00.000Z',
  endedAt: '2026-09-10T10:05:00.000Z',
  durationMs: 300_000,
  ...overrides,
});

describe('normalizeModelId', () => {
  it('strips a context-window suffix, which does not change the rate', () => {
    expect(normalizeModelId('claude-opus-5[1m]')).toBe('claude-opus-5');
  });

  it('strips a release date, which does not change the rate either', () => {
    expect(normalizeModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
  });

  it('leaves an id it does not recognize alone, so an unknown model stays unknown instead of near-missing a real rate', () => {
    expect(normalizeModelId('<synthetic>')).toBe('<synthetic>');
    expect(normalizeModelId('some-other-vendor-model')).toBe('some-other-vendor-model');
  });
});

describe('rateFor', () => {
  it.each(Object.keys(BUNDLED_MODEL_RATES))('prices %s', (model) => {
    expect(rateFor(model)).not.toBeNull();
  });

  it('prices every spelling a transcript can carry for the same model', () => {
    expect(rateFor('claude-opus-5[1m]')).toEqual(rateFor('claude-opus-5'));
    expect(rateFor('claude-haiku-4-5-20251001')).toEqual(rateFor('claude-haiku-4-5'));
  });

  it('returns null for a model with no published rate', () => {
    expect(rateFor('<synthetic>')).toBeNull();
    expect(rateFor('claude-opus-9')).toBeNull();
  });

  it('lets a Settings override win over the bundled table', () => {
    expect(rateFor('claude-opus-5', { 'claude-opus-5': { input: 1, output: 2 } })).toEqual({ input: 1, output: 2 });
  });

  it('lets an override price a model the bundled table has never heard of', () => {
    expect(rateFor('some-new-model', { 'some-new-model': { input: 7, output: 8 } })).toEqual({ input: 7, output: 8 });
  });
});

describe('estimateModelCost', () => {
  it('prices input and output at their published rates', () => {
    // 1M input at $5 + 1M output at $25.
    const cost = estimateModelCost(modelUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(cost).toBeCloseTo(30, 6);
  });

  it('prices a cache write above a plain input token', () => {
    // 1M cache-creation tokens at 1.25x the $5 input rate.
    expect(estimateModelCost(modelUsage({ cacheCreationTokens: 1_000_000 }))).toBeCloseTo(6.25, 6);
  });

  it('prices a cache read at a fraction of an input token', () => {
    // 1M cache-read tokens at 0.1x the $5 input rate.
    expect(estimateModelCost(modelUsage({ cacheReadTokens: 1_000_000 }))).toBeCloseTo(0.5, 6);
  });

  it('uses the cheaper model when the conversation used one', () => {
    const haiku = modelUsage({ model: 'claude-haiku-4-5', inputTokens: 1_000_000 });
    const opus = modelUsage({ model: 'claude-opus-5', inputTokens: 1_000_000 });
    expect(estimateModelCost(haiku)).toBeLessThan(estimateModelCost(opus)!);
  });

  it('returns null — never zero — for an unpriced model, so the UI can say it does not know', () => {
    expect(estimateModelCost(modelUsage({ model: '<synthetic>', inputTokens: 1_000_000 }))).toBeNull();
  });
});

describe('resolveCostUsd', () => {
  it("prefers the CLI's own total, which is a reading rather than an estimate", () => {
    const withReported = usage({
      reportedCostUsd: 4.4,
      models: [modelUsage({ inputTokens: 999_999_999 })],
    });
    expect(resolveCostUsd(withReported)).toBe(4.4);
  });

  it('falls back to the price table when the transcript predates the CLI keeping its own accounting', () => {
    const legacy = usage({ models: [modelUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 })] });
    expect(resolveCostUsd(legacy)).toBeCloseTo(30, 6);
  });

  it("uses the CLI's per-model cost when it has one, even without a conversation total", () => {
    const perModel = usage({ models: [modelUsage({ reportedCostUsd: 1.5 }), modelUsage({ reportedCostUsd: 0.25 })] });
    expect(resolveCostUsd(perModel)).toBeCloseTo(1.75, 6);
  });

  it('is zero for a conversation that never reached the API — that is a known nothing, not an unknown', () => {
    expect(resolveCostUsd(usage({ models: [] }))).toBe(0);
  });

  it('refuses to total a conversation containing an unpriced model, rather than reporting a number that is silently too low', () => {
    const mixed = usage({
      models: [
        modelUsage({ model: 'claude-opus-5', inputTokens: 1_000_000 }),
        modelUsage({ model: '<synthetic>', inputTokens: 1_000_000 }),
      ],
    });
    expect(resolveCostUsd(mixed)).toBeNull();
  });

  it('respects a Settings override when it has to estimate', () => {
    const legacy = usage({ models: [modelUsage({ model: 'claude-opus-5', outputTokens: 1_000_000 })] });
    expect(resolveCostUsd(legacy, { 'claude-opus-5': { input: 0, output: 1 } })).toBeCloseTo(1, 6);
  });
});

describe('primaryModel', () => {
  it('names the model the conversation spent the most output on', () => {
    const mixed = usage({
      models: [
        modelUsage({ model: 'claude-haiku-4-5', outputTokens: 10 }),
        modelUsage({ model: 'claude-opus-5[1m]', outputTokens: 30_213 }),
      ],
    });
    expect(primaryModel(mixed)).toBe('claude-opus-5[1m]');
  });

  it('is null for a conversation that never reached the API', () => {
    expect(primaryModel(usage({ models: [] }))).toBeNull();
  });
});
