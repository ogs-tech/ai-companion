import type { FileOperationsPort } from '../ports/file-operations-port.js';
import type { FileBrowserService } from './file-browser-service.js';
import { walkFiles } from './file-operations-service.js';
import { DomainError } from '../../domain/errors.js';
import {
  SEARCH_MATCH_CAP,
  SEARCH_MAX_FILE_BYTES,
  type SearchMatch,
  type SearchRequest,
  type SearchResult,
} from '../../../shared/file-ops.js';

const MAX_LINE_CHARS = 300;
const CONTEXT_BEFORE = 80;
/** Files processed between yields to the event loop. */
const YIELD_EVERY = 20;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function buildPattern(request: SearchRequest): RegExp {
  const source = request.regex ? request.query : request.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wrapped = request.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(wrapped, request.caseSensitive ? 'g' : 'gi');
  } catch (err) {
    throw new DomainError('validation', `Expressão regular inválida: ${err instanceof Error ? err.message : String(err)}`, {
      reason: 'invalid-regex',
    });
  }
}

/** Leading whitespace dropped and long lines windowed around the match; `start`/`end` index into the returned text. */
function clipLine(line: string, start: number, end: number): { text: string; start: number; end: number } {
  let text = line.endsWith('\r') ? line.slice(0, -1) : line;
  let from = 0;
  const indent = text.length - text.trimStart().length;
  if (indent > 0 && indent <= start) from = indent;
  if (start - from > CONTEXT_BEFORE && text.length - from > MAX_LINE_CHARS) from = start - CONTEXT_BEFORE;
  text = text.slice(from, from + MAX_LINE_CHARS);
  const clippedEnd = Math.min(end - from, text.length);
  return { text, start: start - from, end: clippedEnd };
}

/** Text search over the open workspace's folders; async and cooperative so it never blocks the main process. */
export class ProjectSearchService {
  private readonly active = new Map<string, { cancelled: boolean }>();

  constructor(
    private readonly browser: FileBrowserService,
    private readonly ops: FileOperationsPort,
  ) {}

  cancel(requestId: string): void {
    const entry = this.active.get(requestId);
    if (entry) entry.cancelled = true;
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const pattern = request.query === '' ? null : buildPattern(request);
    // A new request supersedes every older one.
    for (const entry of this.active.values()) entry.cancelled = true;
    const token = { cancelled: false };
    this.active.set(request.requestId, token);
    const cancelledResult: SearchResult = { matches: [], fileCount: 0, truncated: false, cancelled: true };
    try {
      if (pattern === null) return { matches: [], fileCount: 0, truncated: false, cancelled: false };
      const matches: SearchMatch[] = [];
      let fileCount = 0;
      let truncated = false;
      let visited = 0;
      for await (const file of walkFiles(this.ops, this.browser.roots())) {
        if (token.cancelled) return cancelledResult;
        if (++visited % YIELD_EVERY === 0) await yieldToEventLoop();
        const text = await this.ops.readText(file.abs, SEARCH_MAX_FILE_BYTES).catch(() => null);
        if (text === null) continue;
        const before = matches.length;
        const lines = text.split('\n');
        for (let index = 0; index < lines.length && !truncated; index++) {
          const line = lines[index]!;
          pattern.lastIndex = 0;
          for (let found = pattern.exec(line); found !== null; found = pattern.exec(line)) {
            if (found[0] === '') {
              pattern.lastIndex++;
              continue;
            }
            const clipped = clipLine(line, found.index, found.index + found[0].length);
            matches.push({ path: file.rel, line: index + 1, ...clipped });
            if (matches.length >= SEARCH_MATCH_CAP) {
              truncated = true;
              break;
            }
          }
        }
        if (matches.length > before) fileCount++;
        if (truncated) break;
      }
      return token.cancelled ? cancelledResult : { matches, fileCount, truncated, cancelled: false };
    } finally {
      if (this.active.get(request.requestId) === token) this.active.delete(request.requestId);
    }
  }
}
