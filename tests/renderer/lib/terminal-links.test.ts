import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILink, Terminal } from '@xterm/xterm';

vi.mock('../../../src/renderer/lib/browser-tabs-store.js', () => ({ openManualTab: vi.fn(async () => {}) }));

import { openManualTab } from '../../../src/renderer/lib/browser-tabs-store.js';
import {
  embeddedBrowserLinkHandler,
  embeddedBrowserLinkProvider,
  findUrls,
} from '../../../src/renderer/lib/terminal-links.js';

/** Minimal buffer: each entry is one physical row; `wrapped` marks it as a continuation of the previous row. */
function fakeTerminal(rows: Array<{ text: string; wrapped?: boolean }>, cols: number): Terminal {
  return {
    cols,
    buffer: {
      active: {
        getLine: (i: number) => {
          const row = rows[i];
          return row && { isWrapped: row.wrapped === true, translateToString: () => row.text };
        },
      },
    },
  } as unknown as Terminal;
}

function provide(terminal: Terminal, row: number): ILink[] {
  let result: ILink[] | undefined;
  embeddedBrowserLinkProvider(terminal).provideLinks(row, (links) => {
    result = links;
  });
  return result ?? [];
}

describe('findUrls', () => {
  it('finds http and https urls and trims trailing punctuation', () => {
    expect(findUrls('see http://localhost:3000/a?x=1, and (https://example.com).')).toEqual([
      { url: 'http://localhost:3000/a?x=1', start: 4 },
      { url: 'https://example.com', start: 38 },
    ]);
  });

  it('ignores other schemes and bare scheme prefixes', () => {
    expect(findUrls('file:///etc/passwd javascript:alert(1) http://')).toEqual([]);
  });
});

describe('embeddedBrowserLinkProvider', () => {
  beforeEach(() => vi.mocked(openManualTab).mockClear());

  it('rejoins a url wrapped across rows and offers it from either row', () => {
    const terminal = fakeTerminal(
      [{ text: 'http://localhost:63379/?k' }, { text: 'ey=abc', wrapped: true }],
      25,
    );
    for (const row of [1, 2]) {
      const [link] = provide(terminal, row);
      expect(link?.text).toBe('http://localhost:63379/?key=abc');
      expect(link?.range).toEqual({ start: { x: 1, y: 1 }, end: { x: 6, y: 2 } });
    }
  });

  it('returns nothing for a row without a url', () => {
    expect(provide(fakeTerminal([{ text: 'plain text' }], 80), 1)).toEqual([]);
  });

  it('opens the activated url in the embedded browser', () => {
    const [link] = provide(fakeTerminal([{ text: 'http://localhost:1' }], 80), 1);
    link?.activate({} as MouseEvent, link.text);
    expect(openManualTab).toHaveBeenCalledWith('http://localhost:1');
  });
});

describe('embeddedBrowserLinkHandler', () => {
  beforeEach(() => vi.mocked(openManualTab).mockClear());

  it('opens OSC 8 http links and refuses other schemes', () => {
    embeddedBrowserLinkHandler.activate({} as MouseEvent, 'https://a.dev', {} as never);
    embeddedBrowserLinkHandler.activate({} as MouseEvent, 'file:///etc/passwd', {} as never);
    expect(openManualTab).toHaveBeenCalledTimes(1);
    expect(openManualTab).toHaveBeenCalledWith('https://a.dev');
  });
});
