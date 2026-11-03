import { dirname, relative, resolve } from 'node:path';
import type { WritableFileSystemPort } from '../ports/writable-filesystem-port.js';
import type { ClockPort } from '../ports/clock-port.js';
import type { MergeTarget } from '../ports/adapter.js';
import {
  deepEqual,
  detectLayout,
  hashValue,
  matchesIdentity,
  renderJson,
  stableStringify,
} from '../entity/merge-json.js';
import { DomainError, ioError } from '../../domain/errors.js';

export type MergeState = 'ok' | 'missing' | 'drift' | 'foreign';

export interface MergeResult {
  status: 'ok' | 'conflict';
  details?: { backupPath?: string; action?: 'overwritten' };
}

/** `{ files: { <absolute file>: { <entry id>: <hash of the value the app last wrote> } } }` */
interface ManagedIndex {
  version: 1;
  files: Record<string, Record<string, string>>;
}

const INDEX_FILE = 'merge-index.json';

/**
 * Third materialization strategy, next to symlink and whole-file write: puts ONE
 * entry into a JSON file the user also edits (`~/.claude.json`, `~/.cursor/mcp.json`,
 * `hooks.json`, …) and leaves every other byte of its content alone.
 *
 * Ownership is not a marker inside the entry — Claude/Cursor may reject unknown
 * keys — but an index the app keeps next to its backups: per file, which entries
 * it wrote and a hash of what it wrote. That hash is what tells a legitimate
 * update (current value still matches) from drift (the user edited or replaced
 * it), and a managed entry from a foreign one of the same name. A lost index
 * degrades safely: every existing entry then reads as foreign (backup + replace),
 * never as "ours to rewrite quietly".
 *
 * Backups mirror FileMaterializer: `<workspacePath>/_backups/<ts>/<rel>`.
 */
export class MergeMaterializer {
  constructor(
    private readonly fs: WritableFileSystemPort,
    private readonly clock: ClockPort,
    private readonly workspacePath: string,
  ) {}

  async apply(args: {
    file: string;
    target: MergeTarget;
    seed?: Record<string, unknown>;
  }): Promise<MergeResult> {
    const file = resolve(args.file);
    const loaded = await this.load(file);
    const index = await this.readIndex();
    const managed = (index.files[file] ??= {});
    const id = entryId(args.target);
    const { current, present } = locate(loaded.doc, args.target);

    if (present && deepEqual(current, args.target.value)) {
      // Already what we want: adopt it into the index (covers a lost index) without touching the file.
      if (managed[id] !== hashValue(args.target.value)) {
        managed[id] = hashValue(args.target.value);
        await this.writeIndex(index);
      }
      return { status: 'ok' };
    }

    const isPlainUpdate = present && managed[id] !== undefined && managed[id] === hashValue(current);
    const isConflict = present && !isPlainUpdate;

    if (!loaded.existed && args.seed !== undefined) {
      for (const [key, value] of Object.entries(args.seed)) {
        if (!(key in loaded.doc)) loaded.doc[key] = value;
      }
    }
    place(loaded.doc, args.target);

    const result = await this.persist(file, loaded, isConflict);
    managed[id] = hashValue(args.target.value);
    await this.writeIndex(index);
    return result;
  }

  /** Removes the entry only if the app put it there; anything else is left exactly as found. */
  async remove(args: { file: string; target: MergeTarget }): Promise<{ removed: boolean }> {
    const file = resolve(args.file);
    if ((await this.fs.lstat(file)).kind === 'none') return { removed: false };
    const index = await this.readIndex();
    const managed = index.files[file];
    const id = entryId(args.target);
    const stored = managed?.[id];
    if (managed === undefined || stored === undefined) return { removed: false };

    const loaded = await this.load(file);
    const { current, present } = locate(loaded.doc, args.target);
    if (!present) {
      delete managed[id];
      await this.writeIndex(index);
      return { removed: false };
    }
    detach(loaded.doc, args.target);
    // A hand-edited managed entry is still removed (the user disabled the harness), but backed up first.
    await this.persist(file, loaded, hashValue(current) !== stored);
    delete managed[id];
    await this.writeIndex(index);
    return { removed: true };
  }

  async validate(args: { file: string; target: MergeTarget }): Promise<MergeState> {
    const file = resolve(args.file);
    if ((await this.fs.lstat(file)).kind === 'none') return 'missing';
    const loaded = await this.load(file);
    const { current, present } = locate(loaded.doc, args.target);
    if (!present) return 'missing';
    if (deepEqual(current, args.target.value)) return 'ok';
    const stored = (await this.readIndex()).files[file]?.[entryId(args.target)];
    return stored === undefined ? 'foreign' : 'drift';
  }

  private async persist(file: string, loaded: Loaded, backup: boolean): Promise<MergeResult> {
    const nonEmptyBefore = loaded.existed && loaded.raw.trim() !== '';
    let backupPath: string | undefined;
    // Back up whenever bytes of an existing file change — cheap, and the only safe default for a hand-edited file.
    if (nonEmptyBefore) backupPath = await this.backup(file, loaded.raw);
    await this.fs.mkdir(dirname(file), { recursive: true });
    const content = renderJson(loaded.doc, loaded.layout);
    try {
      if (loaded.symlinked) {
        await this.fs.writeFile(file, content); // write through: replacing the link would orphan the user's real file
      } else {
        const tmp = `${file}.${process.pid}.tmp`;
        await this.fs.writeFile(tmp, content);
        await this.fs.rename(tmp, file);
      }
    } catch (err) {
      throw err instanceof DomainError ? err : ioError({ message: err instanceof Error ? err.message : 'write failed' });
    }
    if (!backup) return { status: 'ok' };
    const details: NonNullable<MergeResult['details']> = { action: 'overwritten' };
    if (backupPath !== undefined) details.backupPath = backupPath;
    return { status: 'conflict', details };
  }

  private async load(file: string): Promise<Loaded> {
    const stat = await this.fs.lstat(file);
    if (stat.kind === 'none') {
      return { doc: {}, raw: '', existed: false, symlinked: false, layout: detectLayout('') };
    }
    const raw = await this.fs.readFile(file);
    const layout = detectLayout(raw);
    if (raw.trim() === '') return { doc: {}, raw, existed: true, symlinked: stat.kind === 'symlink', layout };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new DomainError('validation', `Cannot merge into ${file}: it is not valid JSON, so it was left untouched`, {
        reason: 'invalid-json',
      });
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new DomainError('validation', `Cannot merge into ${file}: expected a JSON object at the root`, {
        reason: 'unexpected-shape',
      });
    }
    return { doc: parsed as Record<string, unknown>, raw, existed: true, symlinked: stat.kind === 'symlink', layout };
  }

  private async readIndex(): Promise<ManagedIndex> {
    const path = resolve(this.workspacePath, INDEX_FILE);
    try {
      if (!(await this.fs.pathExists(path))) return { version: 1, files: {} };
      const parsed = JSON.parse(await this.fs.readFile(path)) as Partial<ManagedIndex>;
      if (parsed.version === 1 && parsed.files !== undefined && typeof parsed.files === 'object') {
        return { version: 1, files: parsed.files };
      }
    } catch {
      // Corrupt index: fall through to empty — existing entries then read as foreign.
    }
    return { version: 1, files: {} };
  }

  private async writeIndex(index: ManagedIndex): Promise<void> {
    const path = resolve(this.workspacePath, INDEX_FILE);
    await this.fs.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await this.fs.writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`);
    await this.fs.rename(tmp, path);
  }

  private async backup(destinationPath: string, content: string): Promise<string> {
    let relativeTarget = relative(this.workspacePath, destinationPath);
    if (relativeTarget.startsWith('..')) relativeTarget = destinationPath.replace(/^\/+/, '');
    const timestamp = this.timestampForNow();
    let attempt = 0;
    while (true) {
      const suffix = attempt === 0 ? '' : `-${attempt}`;
      const backupPath = resolve(this.workspacePath, '_backups', `${timestamp}${suffix}`, relativeTarget);
      if (!(await this.fs.pathExists(backupPath))) {
        await this.fs.mkdir(dirname(backupPath), { recursive: true });
        await this.fs.writeFile(backupPath, content);
        return backupPath;
      }
      attempt += 1;
    }
  }

  private timestampForNow(): string {
    const now = this.clock.now();
    const pad = (v: number) => String(v).padStart(2, '0');
    return (
      `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
      `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
    );
  }
}

interface Loaded {
  doc: Record<string, unknown>;
  raw: string;
  existed: boolean;
  symlinked: boolean;
  layout: ReturnType<typeof detectLayout>;
}

function entryId(target: MergeTarget): string {
  const where = target.path.join('.');
  return target.shape === 'object-key' ? `${where}#${target.key}` : `${where}#${stableStringify(target.identity)}`;
}

/** Walks `path` without creating anything; `undefined` when a segment is missing or not an object. */
function walk(doc: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = doc;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function locate(doc: Record<string, unknown>, target: MergeTarget): { current: unknown; present: boolean } {
  const container = walk(doc, target.path);
  if (target.shape === 'object-key') {
    if (container === null || typeof container !== 'object' || Array.isArray(container)) {
      return { current: undefined, present: false };
    }
    const obj = container as Record<string, unknown>;
    return { current: obj[target.key], present: target.key in obj };
  }
  if (!Array.isArray(container)) return { current: undefined, present: false };
  const found = container.find((item) => matchesIdentity(item, target.identity));
  return { current: found, present: found !== undefined };
}

/** Creates missing containers, refusing to overwrite a value of the wrong type. */
function ensureContainer(doc: Record<string, unknown>, path: string[], leaf: 'object' | 'array'): unknown {
  let cur: Record<string, unknown> = doc;
  for (const [i, seg] of path.entries()) {
    const isLeaf = i === path.length - 1;
    const wantArray = isLeaf && leaf === 'array';
    const existing = cur[seg];
    if (existing === undefined || existing === null) {
      cur[seg] = wantArray ? [] : {};
    } else {
      const ok = wantArray ? Array.isArray(existing) : typeof existing === 'object' && !Array.isArray(existing);
      if (!ok) {
        throw new DomainError(
          'validation',
          `Refusing to merge: '${path.slice(0, i + 1).join('.')}' is not a JSON ${wantArray ? 'array' : 'object'}`,
          { reason: 'unexpected-shape' },
        );
      }
    }
    if (isLeaf) return cur[seg];
    cur = cur[seg] as Record<string, unknown>;
  }
  return cur;
}

function place(doc: Record<string, unknown>, target: MergeTarget): void {
  if (target.shape === 'object-key') {
    (ensureContainer(doc, target.path, 'object') as Record<string, unknown>)[target.key] = target.value;
    return;
  }
  const arr = ensureContainer(doc, target.path, 'array') as unknown[];
  const at = arr.findIndex((item) => matchesIdentity(item, target.identity));
  if (at === -1) arr.push(target.value);
  else arr[at] = target.value;
}

/** Removes the entry; an array left empty is dropped so we don't leave `"PreToolUse": []` behind. */
function detach(doc: Record<string, unknown>, target: MergeTarget): void {
  const container = walk(doc, target.path);
  if (target.shape === 'object-key') {
    if (container !== null && typeof container === 'object') delete (container as Record<string, unknown>)[target.key];
    return;
  }
  if (!Array.isArray(container)) return;
  const at = container.findIndex((item) => matchesIdentity(item, target.identity));
  if (at !== -1) container.splice(at, 1);
  if (container.length === 0) {
    const parent = walk(doc, target.path.slice(0, -1));
    const leafKey = target.path[target.path.length - 1];
    if (parent !== null && typeof parent === 'object' && leafKey !== undefined) delete (parent as Record<string, unknown>)[leafKey];
  }
}
