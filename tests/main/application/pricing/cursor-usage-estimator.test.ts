import { describe, expect, it } from 'vitest';
import {
  estimateCursorUsage,
  normalizeCursorModelId,
} from '../../../../src/main/application/pricing/cursor-usage-estimator.js';

const msg = (role: string, content: unknown): string => JSON.stringify({ role, content });
const assistant = (text: string, modelName?: string): string =>
  msg('assistant', [
    {
      type: 'text',
      text,
      ...(modelName ? { providerOptions: { cursor: { modelName } } } : {}),
      signature: 'x'.repeat(4000),
    },
  ]);

describe('normalizeCursorModelId', () => {
  it('strips stacked variant suffixes down to the base model', () => {
    expect(normalizeCursorModelId('claude-opus-4-7-thinking-xhigh')).toBe('claude-opus-4-7');
    expect(normalizeCursorModelId('Claude-Sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(normalizeCursorModelId('auto')).toBe('auto');
    expect(normalizeCursorModelId('composer-2.5-fast')).toBe('composer-2.5-fast'); // a pricier tier, not a variant
    expect(normalizeCursorModelId('grok-4.7-high-fast')).toBe('grok-4.7-fast');
    expect(normalizeCursorModelId('grok-4.7-high')).toBe('grok-4.7');
    expect(normalizeCursorModelId('cursor-grok-4.6-high-fast')).toBe('grok-4.6-fast');
  });
});

describe('estimateCursorUsage', () => {
  it('re-counts the whole history as input on every assistant turn and ignores signatures', () => {
    const usage = estimateCursorUsage([
      msg('system', 'a'.repeat(40)), // 10 tokens
      msg('user', 'b'.repeat(40)), // 10
      assistant('c'.repeat(80), 'claude-opus-4-7-thinking-xhigh'), // 20 out, 20 in
      msg('user', 'd'.repeat(40)), // 10
      assistant('e'.repeat(40)), // 10 out, 50 in (10+10+20+10)
    ]);
    expect(usage).toEqual([
      {
        model: 'claude-opus-4-7',
        inputTokens: 20 + 50,
        outputTokens: 20 + 10,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reportedCostUsd: null,
      },
    ]);
  });

  it('counts tool calls and results as text the model reads', () => {
    const usage = estimateCursorUsage([
      msg('assistant', [{ type: 'tool-call', toolName: 'Shell', args: { command: 'ls' }, providerOptions: { cursor: { modelName: 'm' } } }]),
      msg('tool', [{ type: 'tool-result', result: 'x'.repeat(400) }]),
      assistant('done'),
    ]);
    expect(usage[0]?.inputTokens).toBeGreaterThan(100);
  });

  it('reports "cannot price" instead of a partial sum when a turn has no known model', () => {
    expect(estimateCursorUsage([msg('user', 'hi'), assistant('no model anywhere')])).toEqual([]);
  });

  it('skips unparseable blobs and returns [] for an empty chat', () => {
    expect(estimateCursorUsage(['{ half', msg('user', 'hi')])).toEqual([]);
    expect(estimateCursorUsage([])).toEqual([]);
  });
});
