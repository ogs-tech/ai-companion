import { basename, join, relative } from 'node:path';
import type { FileSystemPort } from '../ports/filesystem-port.js';
import type { EntityService, SaveEntityResult } from './entity-service.js';
import type { DetectedEntity, DetectedHarness, DetectedKind, DetectedListParams } from '../../../shared/detected.js';
import type { Agent, Entity, HookEntity, McpEntity, Skill } from '../../../shared/entity.js';
import { entityUrn, WORKSPACE_SOURCE } from '../../../shared/entity.js';
import type { Instruction } from '../../../shared/entity.js';
import { folderInstructionName, workspaceInstructionName } from '../../../shared/instruction-names.js';
import { workspacePath } from '../../../shared/brand-paths.js';
import { CURSOR_RULE_MDC_MARKER } from '../entity/cursor-plugin-manifest.js';
import { parseEntityFile } from '../entity/entity-serializer.js';
import { translateHookFromCursor, translateHookToCursor } from '../entity/hook-translation.js';
import { hashValue } from '../entity/merge-json.js';
import { mcpServerDefSchema } from '../schemas/mcp.js';
import { claudeHooksFieldSchema } from '../schemas/hook.js';
import { DomainError, validationError } from '../../domain/errors.js';

export interface DetectionContext {
  /** Open workspace id and its folders; `null` at Início (only personal config is read). */
  workspace: { id: string; folders: string[] } | null;
}

export interface DetectionServiceDeps {
  fs: FileSystemPort;
  homedir: string;
  entities: Pick<EntityService, 'list' | 'save'>;
  context: DetectionContext;
  /** Clock for backup folder names; defaults to the current time. */
  now?: () => Date;
}

interface Location {
  scope: 'personal' | 'workspace';
  base: string;
  folder?: string;
}

const CHANNELS: ReadonlyArray<{ id: DetectedHarness; dir: string }> = [
  { id: 'claude', dir: '.claude' },
  { id: 'cursor', dir: '.cursor' },
];
const ALL_KINDS: DetectedKind[] = ['skill', 'agent', 'mcp', 'hook', 'instruction'];

/**
 * Reads what Claude Code and Cursor already have on disk — skills, agents, MCP
 * servers, hooks — and offers it for import. Nothing is adopted on its own:
 * items stay read-only "detected" rows until `import` makes them canonical, at
 * which point the normal save path writes them to every enabled harness.
 *
 * Anything the app itself materialized is invisible here: symlinks (skills,
 * agents) are skipped outright, and entries whose canonical twin exists
 * (same kind + name; hooks by event/matcher/command) are filtered out.
 */
export class DetectionService {
  constructor(private readonly deps: DetectionServiceDeps) {}

  async list(params: DetectedListParams = {}): Promise<DetectedEntity[]> {
    const kinds = params.kinds ?? ALL_KINDS;
    const found: DetectedEntity[] = [];
    const takenInstructionNames = new Set((await this.deps.entities.list('instruction')).map((e) => e.name));
    for (const location of this.locations()) {
      if (kinds.includes('instruction')) found.push(...(await this.instructions(location, takenInstructionNames)));
      for (const harness of CHANNELS) {
        if (kinds.includes('skill')) found.push(...(await this.skills(location, harness)));
        if (kinds.includes('agent')) found.push(...(await this.agents(location, harness)));
        if (kinds.includes('mcp')) found.push(...(await this.mcps(location, harness)));
        if (kinds.includes('hook')) found.push(...(await this.hooks(location, harness)));
      }
    }
    return this.withoutCanonical(found);
  }

  async import(id: string): Promise<SaveEntityResult> {
    const item = (await this.list()).find((d) => d.id === id);
    if (item === undefined) throw new DomainError('not_found', `Detected item not found: ${id}`);
    if (!item.importable) {
      throw validationError({ message: item.reason ?? 'This item cannot be imported', details: { reason: 'not-importable' } });
    }
    const entity = await this.toEntity(item);
    if (item.kind !== 'instruction') return this.deps.entities.save({ entity, isCreate: true });
    // The file occupies a destination the app is about to own: back it up and clear the way
    // first (the sync never overwrites a file it does not own), and put it back if the save fails.
    const backup = await this.moveToBackup(item.path);
    try {
      return await this.deps.entities.save({ entity, isCreate: true });
    } catch (err) {
      await this.deps.fs.copyFile(backup, item.path);
      throw err;
    }
  }

  private locations(): Location[] {
    const out: Location[] = [{ scope: 'personal', base: this.deps.homedir }];
    for (const folder of this.deps.context.workspace?.folders ?? []) {
      out.push({ scope: 'workspace', base: folder, folder });
    }
    return out;
  }

  /** Copies `path` into `~/.ai-companion/_backups/<timestamp>/detected/…`, then removes it. Returns the copy. */
  private async moveToBackup(path: string): Promise<string> {
    const stamp = (this.deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
    const rel = relative(this.deps.homedir, path);
    const flat = (rel.startsWith('..') ? path : rel).replace(/^[\\/]+/, '').replace(/[\\/]+/g, '__');
    const backup = join(workspacePath(this.deps.homedir), '_backups', stamp, 'detected', flat);
    await this.deps.fs.mkdir(join(backup, '..'), { recursive: true });
    await this.deps.fs.copyFile(path, backup);
    await this.deps.fs.unlink(path);
    return backup;
  }

  private make(
    kind: DetectedKind,
    name: string,
    harness: DetectedHarness,
    loc: Location,
    rest: Pick<DetectedEntity, 'description' | 'path' | 'preview'> & { importable?: boolean; reason?: string },
  ): DetectedEntity {
    const { importable = true, reason, ...fields } = rest;
    // An instruction level can hold several files; the file tells them apart.
    const key = { h: harness, k: kind, s: loc.scope, f: loc.folder, n: name, ...(kind === 'instruction' ? { p: rest.path } : {}) };
    return {
      id: Buffer.from(JSON.stringify(key), 'utf8').toString('base64url'),
      kind,
      name,
      harness,
      scope: loc.scope,
      ...(loc.folder !== undefined ? { folder: loc.folder } : {}),
      importable,
      ...(reason !== undefined ? { reason } : {}),
      ...fields,
    };
  }

  // ---- instructions ----------------------------------------------------------

  /**
   * Instruction files of one level (Global, or a workspace folder) that the app
   * does not own: regular files only (a symlink is ours or someone's wiring) and
   * not the app's marked `.mdc`. Whether the level already has an Instruction is
   * decided in `withoutCanonical`.
   */
  private async instructions(loc: Location, taken: ReadonlySet<string>): Promise<DetectedEntity[]> {
    const workspace = this.deps.context.workspace;
    const multi = (workspace?.folders.length ?? 0) > 1;
    let name = 'default';
    let level: Location = loc;
    if (loc.scope === 'workspace') {
      const [rootPath = loc.base, ...extraFolders] = workspace?.folders ?? [];
      const ws = { rootPath, extraFolders };
      name = multi && loc.folder !== undefined ? folderInstructionName(ws, loc.folder, taken) : workspaceInstructionName(ws);
      level = multi ? loc : { scope: 'workspace', base: loc.base };
    }
    const files: Array<{ path: string; harness: DetectedHarness }> = [];
    const claudeFiles = loc.scope === 'personal' ? ['.claude/CLAUDE.md', 'AGENTS.md'] : ['CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md'];
    for (const file of claudeFiles) files.push({ path: join(loc.base, file), harness: 'claude' });
    if (loc.scope === 'workspace') {
      const rules = join(loc.base, '.cursor', 'rules');
      for (const rule of await this.names(rules)) {
        if (rule.endsWith('.mdc')) files.push({ path: join(rules, rule), harness: 'cursor' });
      }
    }
    const out: DetectedEntity[] = [];
    for (const { path, harness } of files) {
      try {
        if ((await this.deps.fs.lstat(path)).kind !== 'file') continue;
      } catch {
        continue;
      }
      const raw = await this.tryRead(path);
      if (raw === undefined || raw.trim() === '' || raw.includes(CURSOR_RULE_MDC_MARKER)) continue;
      out.push(
        this.make('instruction', name, harness, level, {
          description: relative(loc.base, path),
          path,
          preview: { file: basename(path) },
        }),
      );
    }
    return out;
  }

  // ---- skills / agents -------------------------------------------------------

  private async skills(loc: Location, h: (typeof CHANNELS)[number]): Promise<DetectedEntity[]> {
    const root = join(loc.base, h.dir, 'skills');
    const out: DetectedEntity[] = [];
    for (const name of await this.names(root)) {
      const dir = join(root, name);
      if ((await this.deps.fs.lstat(dir)).kind !== 'directory') continue; // symlink = ours or a plugin's
      const file = join(dir, 'SKILL.md');
      const raw = await this.tryRead(file);
      if (raw === undefined) continue;
      const parsed = this.tryParse('skill', name, raw);
      const extra = (await this.deps.fs.readdir(dir)).filter((f) => f !== 'SKILL.md');
      out.push(
        this.make('skill', name, h.id, loc, {
          description: parsed?.description ?? '',
          path: file,
          preview: { content: parsed !== undefined ? (parsed as Skill).content : raw },
          ...(parsed === undefined
            ? { importable: false, reason: 'SKILL.md could not be parsed' }
            : extra.length > 0
              ? { importable: false, reason: `The skill has extra files (${extra.slice(0, 3).join(', ')}); importing only SKILL.md would lose them` }
              : {}),
        }),
      );
    }
    return out;
  }

  private async agents(loc: Location, h: (typeof CHANNELS)[number]): Promise<DetectedEntity[]> {
    const root = join(loc.base, h.dir, 'agents');
    const out: DetectedEntity[] = [];
    for (const file of await this.names(root)) {
      if (!file.endsWith('.md')) continue;
      const path = join(root, file);
      if ((await this.deps.fs.lstat(path)).kind !== 'file') continue;
      const name = file.slice(0, -'.md'.length);
      const raw = await this.tryRead(path);
      if (raw === undefined) continue;
      const parsed = this.tryParse('agent', name, raw);
      out.push(
        this.make('agent', name, h.id, loc, {
          description: parsed?.description ?? '',
          path,
          preview: { systemPrompt: parsed !== undefined ? (parsed as Agent).systemPrompt : raw },
          ...(parsed === undefined ? { importable: false, reason: 'The agent file could not be parsed' } : {}),
        }),
      );
    }
    return out;
  }

  // ---- MCP -------------------------------------------------------------------

  private async mcps(loc: Location, h: (typeof CHANNELS)[number]): Promise<DetectedEntity[]> {
    const file =
      h.id === 'cursor'
        ? join(loc.base, '.cursor', 'mcp.json')
        : loc.scope === 'personal'
          ? join(loc.base, '.claude.json')
          : join(loc.base, '.mcp.json');
    const servers = (await this.readJson(file))?.['mcpServers'];
    if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) return [];
    return Object.entries(servers as Record<string, unknown>).map(([name, raw]) => {
      const def = mcpServerDefSchema.safeParse(raw);
      return this.make('mcp', name, h.id, loc, {
        description: '',
        path: file,
        preview: { def: def.success ? def.data : raw },
        ...(def.success ? {} : { importable: false, reason: 'Not a valid MCP server definition' }),
      });
    });
  }

  // ---- hooks -----------------------------------------------------------------

  private async hooks(loc: Location, h: (typeof CHANNELS)[number]): Promise<DetectedEntity[]> {
    if (h.id === 'claude') {
      const file = join(loc.base, '.claude', 'settings.json');
      const field = (await this.readJson(file))?.['hooks'];
      const parsed = claudeHooksFieldSchema.safeParse(field ?? {});
      if (!parsed.success) return [];
      const out: DetectedEntity[] = [];
      for (const [event, blocks] of Object.entries(parsed.data)) {
        for (const block of blocks) {
          for (const handler of block.hooks) {
            const { _sdeAiId: _drop, ...clean } = handler as Record<string, unknown>;
            void _drop;
            out.push(this.hookRow(loc, h.id, file, event, block.matcher, clean));
          }
        }
      }
      return out;
    }
    const file = join(loc.base, '.cursor', 'hooks.json');
    const byEvent = (await this.readJson(file))?.['hooks'];
    if (byEvent === null || typeof byEvent !== 'object' || Array.isArray(byEvent)) return [];
    const out: DetectedEntity[] = [];
    for (const [cursorEvent, items] of Object.entries(byEvent as Record<string, unknown>)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (item === null || typeof item !== 'object') continue;
        const t = translateHookFromCursor(cursorEvent, item as Record<string, unknown>);
        if (t.ok) {
          const row = this.hookRow(loc, h.id, file, t.event, t.matcher, t.handler);
          const raw = item as Record<string, unknown>;
          row.preview['cursor'] = { event: cursorEvent, command: raw['command'], matcher: raw['matcher'] };
          out.push(row);
        } else {
          const name = `hook-${hashValue({ cursorEvent, item }).slice(0, 8)}`;
          out.push(
            this.make('hook', name, h.id, loc, {
              description: '',
              path: file,
              preview: { event: cursorEvent, handler: item },
              importable: false,
              reason: t.reason,
            }),
          );
        }
      }
    }
    return out;
  }

  private hookRow(
    loc: Location,
    harness: DetectedHarness,
    path: string,
    event: string,
    matcher: string | undefined,
    handler: Record<string, unknown>,
  ): DetectedEntity {
    return this.make('hook', hookName(event, matcher, handler), harness, loc, {
      description: '',
      path,
      preview: { event, ...(matcher !== undefined ? { matcher } : {}), handler },
    });
  }

  // ---- canonical filtering and import ----------------------------------------

  private async withoutCanonical(found: DetectedEntity[]): Promise<DetectedEntity[]> {
    const names = new Set<string>();
    for (const kind of ['skill', 'agent', 'mcp'] as const) {
      for (const e of await this.deps.entities.list(kind)) names.add(entityUrn(kind, e.name));
    }
    // Hooks have no natural name: a canonical hook hides the entries the app wrote
    // for it, matched by (event, matcher, command) in each harness's own shape.
    const claudeKeys = new Set<string>();
    const cursorKeys = new Set<string>();
    for (const e of await this.deps.entities.list('hook')) {
      const hook = e as HookEntity;
      claudeKeys.add(JSON.stringify([hook.event, hook.matcher ?? null, hook.handler['command'] ?? null]));
      const t = translateHookToCursor(hook);
      if (t.ok) cursorKeys.add(JSON.stringify([t.event, t.item['matcher'] ?? null, t.item['command']]));
    }
    // A level that already has an Instruction offers nothing to import: a file still
    // in the way is reported by the sync instead.
    const instructions = (await this.deps.entities.list('instruction')) as Instruction[];
    const levelTaken = (d: DetectedEntity): boolean =>
      instructions.some((e) => e.scopes[0] === d.scope && (d.scope === 'personal' || (e.scopeId === this.deps.context.workspace?.id && e.folder === d.folder)));
    return found.filter((d) => {
      if (d.kind === 'instruction') return !levelTaken(d);
      if (d.kind !== 'hook') return !names.has(entityUrn(d.kind, d.name));
      const cursor = d.preview['cursor'] as { event: string; command: unknown; matcher?: unknown } | undefined;
      if (cursor !== undefined) return !cursorKeys.has(JSON.stringify([cursor.event, cursor.matcher ?? null, cursor.command]));
      const handler = d.preview['handler'] as Record<string, unknown>;
      return !claudeKeys.has(JSON.stringify([d.preview['event'], d.preview['matcher'] ?? null, handler['command'] ?? null]));
    });
  }

  private async toEntity(item: DetectedEntity): Promise<Entity> {
    const workspace = this.deps.context.workspace;
    if (item.scope === 'workspace' && workspace === null) {
      throw validationError({ message: 'No workspace is open', details: { reason: 'no-active-workspace' } });
    }
    const common = {
      urn: entityUrn(item.kind, item.name),
      name: item.name,
      description: item.description,
      scopes: [item.scope] as Entity['scopes'],
      ...(item.scope === 'workspace' && workspace !== null ? { scopeId: workspace.id } : {}),
      ...(item.folder !== undefined ? { folder: item.folder } : {}),
      metadata: { version: '1.0.0', createdAt: '', updatedAt: '' },
      source: WORKSPACE_SOURCE,
    };
    if (item.kind === 'instruction') {
      const raw = await this.deps.fs.readFile(item.path);
      const instruction: Instruction = { ...common, kind: 'instruction', description: '', content: stripFrontmatter(raw) };
      return instruction;
    }
    if (item.kind === 'skill' || item.kind === 'agent') {
      const raw = await this.deps.fs.readFile(item.path);
      const parsed = parseEntityFile({ kind: item.kind, name: item.name, raw, source: WORKSPACE_SOURCE });
      // Keep the parsed body and extra frontmatter, but re-home it to the scope it was found in.
      const { scopes: _s, scopeId: _id, ...body } = parsed;
      void _s;
      void _id;
      return { ...body, ...common, description: parsed.description, ext: parsed.ext } as Entity;
    }
    if (item.kind === 'mcp') {
      const mcp: McpEntity = { ...common, kind: 'mcp', def: item.preview['def'] as Record<string, unknown>, enabled: true };
      return mcp;
    }
    const hook: HookEntity = {
      ...common,
      kind: 'hook',
      event: item.preview['event'] as string,
      ...(typeof item.preview['matcher'] === 'string' ? { matcher: item.preview['matcher'] } : {}),
      handler: item.preview['handler'] as Record<string, unknown>,
      enabled: true,
    };
    return hook;
  }

  // ---- fs helpers ------------------------------------------------------------

  private async names(dir: string): Promise<string[]> {
    try {
      if (!(await this.deps.fs.pathExists(dir))) return [];
      return (await this.deps.fs.readdir(dir)).filter((n) => !n.startsWith('.'));
    } catch {
      return [];
    }
  }

  private async tryRead(path: string): Promise<string | undefined> {
    try {
      return await this.deps.fs.readFile(path);
    } catch {
      return undefined;
    }
  }

  private tryParse(kind: 'skill' | 'agent', name: string, raw: string): Skill | Agent | undefined {
    try {
      return parseEntityFile({ kind, name, raw, source: WORKSPACE_SOURCE }) as Skill | Agent;
    } catch {
      return undefined;
    }
  }

  /** Unreadable or invalid JSON is "nothing detected", never an error: these are the user's own files. */
  private async readJson(path: string): Promise<Record<string, unknown> | undefined> {
    const raw = await this.tryRead(path);
    if (raw === undefined || raw.trim() === '') return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
}

/** A Cursor `.mdc` rule opens with `---` frontmatter; the instruction is only its body. */
function stripFrontmatter(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
  return (match ? raw.slice(match[0].length) : raw).replace(/^\s*\n/, '');
}

/** Stable, slug-safe name for a hook (hooks have no natural name). */
export function hookName(event: string, matcher: string | undefined, handler: Record<string, unknown>): string {
  return `hook-${hashValue({ event, matcher, handler }).slice(0, 8)}`;
}
