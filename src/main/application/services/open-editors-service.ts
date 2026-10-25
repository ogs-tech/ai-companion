import path from 'node:path';
import { EMPTY_OPEN_EDITORS, type OpenEditorsState, type PersistedTab } from '../../../shared/open-editors.js';
import type { WritableFileSystemPort } from '../ports/writable-filesystem-port.js';

export const OPEN_EDITORS_FILE = 'open-editors.json';

const AREAS: ReadonlySet<string> = new Set(['workspaces', 'starter-pack', 'marketplaces', 'diagnostico']);
const ENTITY_KINDS: ReadonlySet<string> = new Set(['skill', 'agent', 'instruction']);
const ANCHOR_KINDS: ReadonlySet<string> = new Set(['entity', 'personal', 'workspace']);
const DIFF_SOURCE_KINDS: ReadonlySet<string> = new Set(['worktree', 'index', 'commit']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const hasKindIn = (value: unknown, kinds: ReadonlySet<string>): boolean =>
  isRecord(value) && typeof value['kind'] === 'string' && kinds.has(value['kind']);

/** Returns the tab when every field its kind needs is well-formed, `null` otherwise — the file is hand-editable, so nothing in it is trusted. */
function parseTab(raw: unknown): PersistedTab | null {
  if (!isRecord(raw) || !isNonEmptyString(raw['id'])) return null;
  const id = raw['id'];
  switch (raw['kind']) {
    case 'file':
    case 'file-preview':
      return isNonEmptyString(raw['relPath']) ? { id, kind: raw['kind'], relPath: raw['relPath'] } : null;
    case 'entity':
      return typeof raw['entityKind'] === 'string' && ENTITY_KINDS.has(raw['entityKind']) && isNonEmptyString(raw['urn'])
        ? { id, kind: 'entity', entityKind: raw['entityKind'] as 'skill' | 'agent' | 'instruction', urn: raw['urn'], inherited: raw['inherited'] === true }
        : null;
    case 'session':
      return hasKindIn(raw['anchor'], ANCHOR_KINDS) && isNonEmptyString(raw['sessionId']) && typeof raw['label'] === 'string'
        ? { id, kind: 'session', anchor: raw['anchor'] as never, sessionId: raw['sessionId'], label: raw['label'] }
        : null;
    case 'terminal':
      return isNonEmptyString(raw['terminalId']) ? { id, kind: 'terminal', terminalId: raw['terminalId'] } : null;
    case 'git-diff':
      return isNonEmptyString(raw['path']) && hasKindIn(raw['source'], DIFF_SOURCE_KINDS)
        ? { id, kind: 'git-diff', path: raw['path'], source: raw['source'] as never }
        : null;
    case 'history':
      return { id, kind: 'history' };
    case 'area':
      return typeof raw['area'] === 'string' && AREAS.has(raw['area'])
        ? { id, kind: 'area', area: raw['area'] as 'workspaces' | 'starter-pack' | 'marketplaces' | 'diagnostico' }
        : null;
    default:
      return null;
  }
}

function parseState(raw: unknown): OpenEditorsState {
  if (!isRecord(raw) || !Array.isArray(raw['tabs'])) return EMPTY_OPEN_EDITORS;
  const seen = new Set<string>();
  const tabs: PersistedTab[] = [];
  for (const candidate of raw['tabs']) {
    const tab = parseTab(candidate);
    if (tab === null || seen.has(tab.id)) continue;
    seen.add(tab.id);
    tabs.push(tab);
  }
  return { tabs, activeTabId: isNonEmptyString(raw['activeTabId']) ? raw['activeTabId'] : null };
}

/**
 * Remembers which Workbench tabs were open in one data dir (a workspace's, or
 * Global's at Início) so a reload brings them back. Stores references only —
 * see `PersistedTab`.
 */
export class OpenEditorsService {
  private readonly filePath: string;

  constructor(
    private readonly fs: WritableFileSystemPort,
    dataDir: string,
  ) {
    this.filePath = path.join(dataDir, OPEN_EDITORS_FILE);
  }

  /** A missing or corrupt file is "nothing was open", never an error — losing a tab list must not block the app. */
  async load(): Promise<OpenEditorsState> {
    if (!(await this.fs.pathExists(this.filePath))) return EMPTY_OPEN_EDITORS;
    try {
      return parseState(JSON.parse(await this.fs.readFile(this.filePath)));
    } catch {
      return EMPTY_OPEN_EDITORS;
    }
  }

  async save(raw: unknown): Promise<void> {
    const state = parseState(raw);
    await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.fs.writeFile(this.filePath, JSON.stringify(state, null, 2));
  }
}
