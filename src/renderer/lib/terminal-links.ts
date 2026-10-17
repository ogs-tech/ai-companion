import type { ILink, ILinkProvider, ITerminalOptions, Terminal } from '@xterm/xterm';
import { openManualTab } from './browser-tabs-store.js';

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

export interface UrlMatch {
  readonly url: string;
  /** Offset of the first character within the logical line. */
  readonly start: number;
}

/** Finds `http(s)` URLs in one logical line, dropping the sentence punctuation that tends to trail them. */
export function findUrls(text: string): UrlMatch[] {
  const matches: UrlMatch[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '');
    if (url.length > 'https://'.length) matches.push({ url, start: match.index });
  }
  return matches;
}

/** Only `http(s)` is ever opened — an OSC 8 hyperlink can carry any scheme, and the embedded browser must not be a way to reach `file:` or custom protocols. */
function openInEmbeddedBrowser(url: string): void {
  if (/^https?:\/\//i.test(url)) void openManualTab(url);
}

/**
 * Terminal output wraps a long URL across rows; xterm only hands a provider one
 * row at a time, so the logical line is rebuilt by following `isWrapped` in both
 * directions, then each match is mapped back onto (row, column) ranges.
 */
export const embeddedBrowserLinkProvider = (terminal: Terminal): ILinkProvider => ({
  provideLinks(row, callback) {
    const buffer = terminal.buffer.active;
    let first = row - 1;
    while (first > 0 && buffer.getLine(first)?.isWrapped) first -= 1;
    let last = row - 1;
    while (buffer.getLine(last + 1)?.isWrapped) last += 1;

    let text = '';
    for (let i = first; i <= last; i += 1) {
      text += buffer.getLine(i)?.translateToString(i === last) ?? '';
    }

    const cols = terminal.cols;
    const toPosition = (offset: number): { x: number; y: number } => ({
      x: (offset % cols) + 1,
      y: first + Math.floor(offset / cols) + 1,
    });

    const links: ILink[] = [];
    for (const { url, start } of findUrls(text)) {
      const begin = toPosition(start);
      const end = toPosition(start + url.length - 1);
      if (row < begin.y || row > end.y) continue;
      links.push({ text: url, range: { start: begin, end }, activate: () => openInEmbeddedBrowser(url) });
    }
    callback(links.length > 0 ? links : undefined);
  },
});

/** Options routing OSC 8 hyperlinks (what the `claude` CLI emits) to the embedded browser instead of xterm's default `window.open`. */
export const embeddedBrowserLinkHandler: NonNullable<ITerminalOptions['linkHandler']> = {
  activate: (_event, url) => openInEmbeddedBrowser(url),
};

/** Makes URLs in the terminal — plain text or OSC 8 — open as a tab in the app's embedded browser. */
export function attachEmbeddedBrowserLinks(terminal: Terminal): void {
  terminal.registerLinkProvider(embeddedBrowserLinkProvider(terminal));
}
