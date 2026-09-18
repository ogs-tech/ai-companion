import { describe, it, expect, afterEach } from 'vitest';
import {
  NumbersConverterAdapter,
  classifyExportFailure,
} from '../../../../src/main/infrastructure/spreadsheet/numbers-converter-adapter.js';

/**
 * The export itself drives Numbers.app over Apple events, which no test
 * environment has — so what is pinned here is everything around it: which
 * files the converter claims, how it refuses off-macOS, and how it turns an
 * `osascript` rejection into something worth showing the user.
 */

const realPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
});

function pretendPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('NumbersConverterAdapter.supports', () => {
  const adapter = new NumbersConverterAdapter();

  it('claims .numbers documents regardless of case', () => {
    expect(adapter.supports('/a/b/catalog.numbers')).toBe(true);
    expect(adapter.supports('/a/b/CATALOG.NUMBERS')).toBe(true);
  });

  it('leaves every other format to the native readers', () => {
    expect(adapter.supports('/a/b/catalog.xlsx')).toBe(false);
    expect(adapter.supports('/a/b/notes.md')).toBe(false);
    expect(adapter.supports('/a/b/numbers')).toBe(false);
  });
});

describe('NumbersConverterAdapter.toXlsx', () => {
  it('refuses off macOS without spawning anything', async () => {
    pretendPlatform('win32');
    await expect(new NumbersConverterAdapter().toXlsx('/a/b/c.numbers')).rejects.toMatchObject({
      failure: 'unavailable',
    });
  });
});

describe('classifyExportFailure', () => {
  it('reads a killed process as a timeout, since that is how the deadline fires', () => {
    expect(classifyExportFailure({ killed: true, signal: 'SIGTERM' })).toMatchObject({
      failure: 'timed_out',
    });
  });

  it('recognizes a denied automation request by its Apple event code', () => {
    const err = { stderr: 'execution error: Not authorized to send Apple events to Numbers. (-1743)' };
    const classified = classifyExportFailure(err);
    expect(classified.failure).toBe('permission_denied');
    // The reason reaches the user verbatim, so it has to say what to do about it.
    expect(classified.message).toContain('Automation');
  });

  it('recognizes a denied request even when macOS localizes the prose', () => {
    // Only the numeric code survives translation — matching on it is the point.
    expect(classifyExportFailure({ stderr: 'erro de execução: … (-1743)' })).toMatchObject({
      failure: 'permission_denied',
    });
  });

  it('recognizes a missing Numbers install', () => {
    expect(
      classifyExportFailure({ stderr: "execution error: Can't find application. (-10814)" }),
    ).toMatchObject({ failure: 'unavailable' });
  });

  it('falls back to a generic failure for anything unrecognized', () => {
    expect(classifyExportFailure({ stderr: 'something else entirely' })).toMatchObject({
      failure: 'failed',
    });
    expect(classifyExportFailure(undefined)).toMatchObject({ failure: 'failed' });
  });
});

describe('classifyExportFailure — missing install phrasing', () => {
  it("recognizes osascript's actual wording for an app it cannot resolve", () => {
    expect(
      classifyExportFailure({ stderr: `execution error: Can't get application "Numbers". (-1728)` }),
    ).toMatchObject({ failure: 'unavailable' });
  });
});
