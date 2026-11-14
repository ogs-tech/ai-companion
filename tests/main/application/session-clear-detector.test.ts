import { describe, expect, it } from 'vitest';
import { ClearCommandDetector } from '../../../src/main/application/session-clear-detector.js';

const detector = (): ClearCommandDetector => new ClearCommandDetector(new Set(['/clear', '/new']));

describe('ClearCommandDetector', () => {
  it('fires on a submitted command, typed in one write or many', () => {
    expect(detector().feed('/clear\r')).toBe(true);
    const d = detector();
    expect(d.feed('/n')).toBe(false);
    expect(d.feed('ew')).toBe(false);
    expect(d.feed('\r')).toBe(true);
  });

  it('only fires on Enter and resets afterwards', () => {
    const d = detector();
    expect(d.feed('/clear')).toBe(false);
    expect(d.feed('\r')).toBe(true);
    expect(d.feed('\r')).toBe(false);
  });

  it('honours backspace and Ctrl+U', () => {
    expect(detector().feed('/clearx\x7f\r')).toBe(true);
    expect(detector().feed('/clear\x15\r')).toBe(false);
  });

  it('gives up on a line that saw an escape sequence', () => {
    expect(detector().feed('/clear\x1b[D\r')).toBe(false);
    expect(detector().feed('\x1b[200~/clear\x1b[201~\r')).toBe(false);
  });

  it('ignores other text', () => {
    expect(detector().feed('/clear it\r')).toBe(false);
    expect(detector().feed('hello /clear\r')).toBe(false);
  });
});
