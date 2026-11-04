import { describe, it, expect } from 'vitest';
import { relativeTime } from '../../../src/renderer/lib/relative-time.js';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

describe('relativeTime', () => {
  it('buckets by magnitude', () => {
    expect(relativeTime(ago(10_000), NOW)).toBe('agora');
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe('5 min');
    expect(relativeTime(ago(2 * 3_600_000), NOW)).toBe('2 h');
    expect(relativeTime(ago(30 * 3_600_000), NOW)).toBe('ontem');
    expect(relativeTime(ago(3 * 86_400_000), NOW)).toBe('3 d');
  });

  it('is empty for a missing or invalid timestamp', () => {
    expect(relativeTime(undefined, NOW)).toBe('');
    expect(relativeTime('nope', NOW)).toBe('');
  });
});
