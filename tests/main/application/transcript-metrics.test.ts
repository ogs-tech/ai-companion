import { describe, expect, it } from 'vitest';
import { lastSentence, metricsFromLines } from '../../../src/main/application/transcript-metrics.js';
import { contextFraction, contextLevel, contextWindowFor } from '../../../src/shared/session-metrics.js';

const assistant = (text: string, usage: Record<string, number>, extra: Record<string, unknown> = {}, model = 'claude-sonnet-5-5') => ({
  type: 'assistant',
  message: { model, content: [{ type: 'text', text }], usage },
  ...extra,
});

describe('metricsFromLines', () => {
  it('reads cost from the CLI\'s cost-state and context from the last assistant usage (input + both caches)', () => {
    const metrics = metricsFromLines(
      [
        assistant('First.', { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }),
        assistant('Done. Want me to run the tests?', { input_tokens: 5, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 5_000 }),
        { type: 'cost-state', totalCostUSD: 1.42 },
      ],
      'claude',
      0,
    );
    expect(metrics).toMatchObject({ costUsd: 1.42, contextTokens: 95_005, contextWindow: 200_000, model: 'claude-sonnet-5-5', lastAssistantText: 'Want me to run the tests?' });
  });

  it('refuses a cost the CLI itself flagged as incomplete', () => {
    expect(metricsFromLines([{ type: 'cost-state', totalCostUSD: 3, hasUnknownModelCost: true }], 'claude', 0).costUsd).toBeUndefined();
  });

  it('reports a rate limit from a trailing API-error entry, with its reset time, and drops it once the reset passed', () => {
    const limit = assistant('Claude AI usage limit reached|2000000000', {}, { isApiErrorMessage: true });
    const now = 1_999_000_000_000;
    expect(metricsFromLines([limit], 'claude', now).rateLimit).toEqual({ message: 'Claude AI usage limit reached', resetsAt: 2_000_000_000_000 });
    expect(metricsFromLines([limit], 'claude', 2_100_000_000_000).rateLimit).toBeUndefined();
  });

  it('a normal reply after a limit entry means the limit is over', () => {
    const lines = [assistant('usage limit reached', {}, { isApiErrorMessage: true }), assistant('Back.', { input_tokens: 10 })];
    expect(metricsFromLines(lines, 'claude', 0).rateLimit).toBeUndefined();
  });

  it('hides the context bar for an unknown window instead of guessing', () => {
    const lines = [assistant('Hi.', { input_tokens: 100 }, {}, 'some-unlisted-model')];
    expect(metricsFromLines(lines, 'cursor', 0).contextTokens).toBeUndefined();
    expect(metricsFromLines(lines, 'claude', 0).contextWindow).toBe(200_000);
  });
});

describe('model windows and levels', () => {
  it('uses the 1M suffix, the table, and null for the unknown', () => {
    expect(contextWindowFor('claude-opus-5[1m]', 'claude')).toBe(1_000_000);
    expect(contextWindowFor('gpt-5-codex', 'cursor')).toBe(400_000);
    expect(contextWindowFor('mystery', 'cursor')).toBeNull();
    expect(contextWindowFor(null, 'claude')).toBeNull();
  });
  it('amber past 70%, red past 90%', () => {
    expect([0.5, 0.71, 0.91].map(contextLevel)).toEqual(['ok', 'warn', 'danger']);
    expect(contextFraction({ contextTokens: 1, contextWindow: 4 })).toBe(0.25);
    expect(contextFraction({})).toBeNull();
  });
  it('cuts a long reply to its last sentence', () => {
    expect(lastSentence('One. Two! Three?')).toBe('Three?');
  });
});
