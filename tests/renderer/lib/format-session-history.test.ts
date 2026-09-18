import { describe, it, expect } from 'vitest';
import {
  describeCostSource,
  formatCostUsd,
  formatDayShort,
  formatDuration,
  formatModel,
  formatTokens,
  formatWhen,
} from '../../../src/renderer/lib/format-session-history.js';

describe('formatCostUsd', () => {
  it('shows two decimals so a column of costs lines up', () => {
    expect(formatCostUsd(4.4)).toBe('$4.40');
    expect(formatCostUsd(31.799)).toBe('$31.80');
  });

  it('rounds sub-cent spend to zero rather than letting it vanish, because nothing spent is a different fact from nothing known', () => {
    expect(formatCostUsd(0.001)).toBe('$0.00');
    expect(formatCostUsd(0)).toBe('$0.00');
  });

  it('shows a dash when the cost is unknown', () => {
    expect(formatCostUsd(null)).toBe('—');
  });
});

describe('describeCostSource', () => {
  it('distinguishes a number read from the CLI from one this app estimated', () => {
    expect(describeCostSource('reported')).toContain('informado');
    expect(describeCostSource('estimated')).toContain('estimado');
    expect(describeCostSource('unknown')).toContain('sem preço');
  });
});

describe('formatDuration', () => {
  it.each([
    [4_000, '4s'],
    [59_000, '59s'],
    [60_000, '1min'],
    [180_000, '3min'],
    [3_600_000, '1h00'],
    [4_320_000, '1h12'],
  ])('renders %ims as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('shows a dash when there is no duration to show', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });
});

describe('formatWhen', () => {
  const now = new Date('2026-09-17T15:00:00');

  it('gives a clock time for something that happened today', () => {
    expect(formatWhen(new Date('2026-09-17T09:30:00').toISOString(), now)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('gives a weekday for something earlier this week', () => {
    const result = formatWhen(new Date('2026-09-15T09:30:00').toISOString(), now);
    expect(result).not.toMatch(/^\d{2}:\d{2}$/);
    expect(result).not.toContain('/');
  });

  it('gives a date for anything older than a week', () => {
    expect(formatWhen(new Date('2026-08-01T09:30:00').toISOString(), now)).toMatch(/^\d{2}\/\d{2}$/);
  });

  it('shows a dash for an unparseable timestamp', () => {
    expect(formatWhen('not a date', now)).toBe('—');
  });
});

describe('formatModel', () => {
  it('drops the vendor prefix, which is the same on every row', () => {
    expect(formatModel('claude-opus-5')).toBe('opus-5');
  });

  it('drops the release date, which never distinguishes one row from another', () => {
    expect(formatModel('claude-haiku-4-5-20251001')).toBe('haiku-4-5');
  });

  it('keeps the context window, which does', () => {
    expect(formatModel('claude-opus-5[1m]')).toBe('opus-5 1m');
  });

  it('shows a dash for a conversation that never reached the API', () => {
    expect(formatModel(null)).toBe('—');
  });
});

describe('formatTokens', () => {
  it.each([
    [999, '999'],
    [1200, '1.2k'],
    [4_539_109, '4.5M'],
  ])('renders %i as %s', (tokens, expected) => {
    expect(formatTokens(tokens)).toBe(expected);
  });
});

describe('formatDayShort', () => {
  it('drops the year, which a chart axis has no room for', () => {
    expect(formatDayShort('2026-09-10')).toBe('10/09');
  });

  it('leaves anything it does not recognize alone', () => {
    expect(formatDayShort('whenever')).toBe('whenever');
  });
});
