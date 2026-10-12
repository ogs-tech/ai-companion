import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Workspace } from '../../../shared/workspace.js';
import { WORKSPACE_REGISTRY_SCHEMA_VERSION } from '../../../shared/workspace.js';
import { workspaceIndexMarkerPath, workspacePath } from '../../../shared/brand-paths.js';
import type { WritableFileSystemPort } from '../ports/writable-filesystem-port.js';
import type { DirectoryResolver } from '../ports/directory-resolver.js';
import type { WorkspaceRegistry } from '../ports/workspace-registry.js';
import type { ClockPort } from '../ports/clock-port.js';
import { parseMarkdown, serializeMarkdown } from '../markdown/frontmatter.js';
import { DomainError } from '../../domain/errors.js';

/** The v1 registry shape — read once, here, and never written again. */
interface LegacyWorkspace {
  id: string;
  name: string;
  rootPath: string;
  isDefault?: boolean;
  createdAt: string;
}

interface LegacyProject {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface MigrationLogEntry {
  step: string;
  message: string;
  path?: string;
}

export interface WorkspaceModelMigrationResult {
  migrated: boolean;
  /** Set when `migrated` — where the pre-migration copies and `log.json` live. */
  backupDir?: string;
  /** Workspaces whose canonical files moved or changed — each needs a full adapter sync. */
  touchedWorkspaceIds: string[];
  log: MigrationLogEntry[];
}

export interface WorkspaceModelMigrationDeps {
  fs: WritableFileSystemPort & DirectoryResolver;
  registry: WorkspaceRegistry;
  bootstrap: { create(dataDir: string): Promise<void> };
  clock: ClockPort;
  homedir: string;
  /** `~/.ai-companion` — Global's data dir, and the old default workspace's. */
  globalDataDir: string;
}

/** An old data dir to scan; `ownerId === null` is Global's (the old default workspace's). */
interface Source {
  dataDir: string;
  ownerId: string | null;
}

type Target = { kind: 'global' } | { kind: 'workspace'; id: string } | { kind: 'dangling'; reason: string };

const ENTITY_SUBDIRS = ['skills', 'agents', 'instructions', 'global-instructions'] as const;
const PROJECTS_FILE = 'projects.json';
const REGISTRY_FILE = 'workspaces.json';
const INSTRUCTIONS_PROJECT_SUBDIR = join('instructions', 'project');

/**
 * One-time move from the three-level model (personal · workspace · project) to
 * two (Global · workspace). See
 * docs/superpowers/specs/2026-10-12-folder-workspace-model-design.md §3.
 *
 * Every step is safe to re-run from the original files: new workspaces get
 * ids derived from their source (a project's own id, or the folder's path),
 * moves check their destination first, and `workspaces.json` — the only
 * thing that marks the migration done — is written last.
 */
export class WorkspaceModelMigration {
  private readonly log: MigrationLogEntry[] = [];
  private readonly kept: Workspace[] = [];
  private readonly created: Workspace[] = [];
  private readonly bootstrapped = new Set<string>();
  private readonly touched = new Set<string>();
  private home = '';

  constructor(private readonly deps: WorkspaceModelMigrationDeps) {}

  async run(): Promise<WorkspaceModelMigrationResult> {
    const { fs, globalDataDir } = this.deps;
    const registryPath = join(globalDataDir, REGISTRY_FILE);
    const legacy = await this.readJson(registryPath);

    if (legacy === null) {
      // Fresh install — nothing to move, just start on the new shape.
      await this.deps.registry.save({
        schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION,
        workspaces: [],
        activeWorkspaceId: null,
      });
      return { migrated: false, touchedWorkspaceIds: [], log: [] };
    }
    if (typeof legacy['schemaVersion'] === 'number' && legacy['schemaVersion'] >= WORKSPACE_REGISTRY_SCHEMA_VERSION) {
      return { migrated: false, touchedWorkspaceIds: [], log: [] };
    }

    const stamp = this.deps.clock.now().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(globalDataDir, '_backups', `migration-v2-${stamp}`);

    try {
      this.home = (await fs.realDirectory(this.deps.homedir)) ?? this.deps.homedir;
      const legacyWorkspaces = Array.isArray(legacy['workspaces']) ? (legacy['workspaces'] as LegacyWorkspace[]) : [];
      const { sources, alias } = await this.classify(legacyWorkspaces);

      await this.backup(backupDir, registryPath, sources);
      const { projectTargets, markerPaths, projectFiles } = await this.mapProjects(sources);
      await this.removeProjectMarkers(markerPaths, sources);
      // A re-run after a crash may find an entity already moved into a new
      // workspace's dir but not yet rescoped — scanning those dirs too lets it
      // converge instead of leaving that file behind.
      for (const created of this.created) {
        const dir = workspacePath(created.rootPath);
        if (!sources.some((s) => resolve(s.dataDir) === resolve(dir))) sources.push({ dataDir: dir, ownerId: created.id });
      }
      for (const source of sources) {
        await this.migrateDataDir(source, projectTargets, alias, backupDir);
      }

      const workspaces = [...this.kept, ...this.created];
      const legacyActive = typeof legacy['activeWorkspaceId'] === 'string' ? alias.get(legacy['activeWorkspaceId']) : undefined;
      await this.deps.registry.save({
        schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION,
        workspaces,
        activeWorkspaceId: workspaces.some((w) => w.id === legacyActive) ? (legacyActive ?? null) : null,
      });

      // After the commit, so a re-run after a crash still finds the project map.
      for (const file of projectFiles) {
        await fs.remove(file).catch(() => this.note('7', 'Could not delete projects.json', file));
      }
      await this.writeLog(backupDir);
      return { migrated: true, backupDir, touchedWorkspaceIds: [...this.touched], log: this.log };
    } catch (err) {
      this.note('abort', err instanceof Error ? err.message : String(err));
      await this.writeLog(backupDir).catch(() => undefined);
      throw new DomainError(
        'io',
        `Workspace migration failed: ${err instanceof Error ? err.message : String(err)}. Backup: ${backupDir}`,
        { backupDir },
      );
    }
  }

  /** Splits old workspaces into Global (the default, or any rooted at home) and the ones that survive. */
  private async classify(legacyWorkspaces: LegacyWorkspace[]): Promise<{ sources: Source[]; alias: Map<string, string> }> {
    const sources: Source[] = [{ dataDir: this.deps.globalDataDir, ownerId: null }];
    const alias = new Map<string, string>();
    for (const legacy of legacyWorkspaces) {
      const root = (await this.deps.fs.realDirectory(legacy.rootPath)) ?? stripTrailingSep(legacy.rootPath);
      if (legacy.isDefault === true || root === this.home) continue;
      const duplicate = this.kept.find((w) => w.rootPath === root);
      if (duplicate) {
        alias.set(legacy.id, duplicate.id);
        this.note('2', `Workspace '${legacy.name}' shares its folder with '${duplicate.name}' — merged`, root);
        continue;
      }
      this.kept.push({ id: legacy.id, name: legacy.name, rootPath: root, createdAt: legacy.createdAt });
      alias.set(legacy.id, legacy.id);
      sources.push({ dataDir: workspacePath(root), ownerId: legacy.id });
    }
    return { sources, alias };
  }

  /** Step 1 — copies of everything the migration may touch, under their absolute paths. */
  private async backup(backupDir: string, registryPath: string, sources: Source[]): Promise<void> {
    await this.copyTree(registryPath, this.backupPathFor(backupDir, registryPath));
    for (const { dataDir } of sources) {
      for (const sub of [...ENTITY_SUBDIRS, PROJECTS_FILE]) {
        const path = join(dataDir, sub);
        if (await this.deps.fs.pathExists(path)) await this.copyTree(path, this.backupPathFor(backupDir, path));
      }
    }
  }

  /** Step 2 — every registered project becomes (or joins) the workspace for its folder. */
  private async mapProjects(sources: Source[]): Promise<{
    projectTargets: Map<string, Target>;
    markerPaths: string[];
    projectFiles: string[];
  }> {
    const projectTargets = new Map<string, Target>();
    const markerPaths: string[] = [];
    const projectFiles: string[] = [];
    for (const { dataDir } of sources) {
      const file = join(dataDir, PROJECTS_FILE);
      if (!(await this.deps.fs.pathExists(file))) continue;
      projectFiles.push(file);
      let projects: LegacyProject[];
      try {
        const parsed = JSON.parse(await this.deps.fs.readFile(file)) as { projects?: unknown };
        if (!Array.isArray(parsed.projects)) throw new Error('missing projects array');
        projects = parsed.projects as LegacyProject[];
      } catch (err) {
        this.note('2', `Skipped unreadable projects.json: ${err instanceof Error ? err.message : String(err)}`, file);
        continue;
      }
      for (const project of projects) {
        markerPaths.push(workspaceIndexMarkerPath(workspacePath(stripTrailingSep(project.path))));
        projectTargets.set(project.id, await this.workspaceForFolder(project.path, project.name, project.id, project.createdAt));
      }
    }
    return { projectTargets, markerPaths, projectFiles };
  }

  /** The workspace for a folder — an existing one, or a new one with a deterministic id. */
  private async workspaceForFolder(path: string, name: string, id: string, createdAt: string): Promise<Target> {
    const root = await this.deps.fs.realDirectory(path);
    if (root === null) return { kind: 'dangling', reason: `folder no longer exists: ${path}` };
    if (root === this.home) return { kind: 'global' };
    const existing = [...this.kept, ...this.created].find((w) => w.rootPath === root);
    if (existing) return { kind: 'workspace', id: existing.id };
    const workspace: Workspace = { id, name, rootPath: root, createdAt };
    this.created.push(workspace);
    this.note('2', `Created workspace '${name}'`, root);
    return { kind: 'workspace', id };
  }

  /** Step 7 (first half) — project index markers were symlinks into the parent's data dir. */
  private async removeProjectMarkers(markerPaths: string[], sources: Source[]): Promise<void> {
    const dataDirs = sources.map((s) => resolve(s.dataDir));
    for (const marker of markerPaths) {
      const entry = await this.deps.fs.lstat(marker);
      if (entry.kind !== 'symlink') continue;
      const target = resolve(await this.deps.fs.readlink(marker));
      if (dataDirs.some((dir) => isInside(target, dir))) {
        await this.deps.fs.unlink(marker);
        this.note('7', 'Removed project index marker symlink', marker);
      }
    }
  }

  /** Steps 3–6 for one old data dir. */
  private async migrateDataDir(
    source: Source,
    projectTargets: Map<string, Target>,
    alias: Map<string, string>,
    backupDir: string,
  ): Promise<void> {
    for (const name of await this.listDir(join(source.dataDir, 'skills'))) {
      const dir = join(source.dataDir, 'skills', name);
      if (await this.deps.fs.pathExists(join(dir, 'SKILL.md'))) {
        await this.migrateMarkdownEntity(source, 'skills', name, projectTargets, alias, backupDir);
      }
    }
    for (const file of await this.listDir(join(source.dataDir, 'agents'))) {
      if (file.endsWith('.md')) {
        await this.migrateMarkdownEntity(source, 'agents', file.slice(0, -'.md'.length), projectTargets, alias, backupDir);
      }
    }
    await this.migratePersonalInstruction(source, backupDir);
    for (const slug of await this.listDir(join(source.dataDir, INSTRUCTIONS_PROJECT_SUBDIR))) {
      await this.migrateWorkspaceInstruction(source, slug, projectTargets, backupDir);
    }
  }

  private async migrateMarkdownEntity(
    source: Source,
    folder: 'skills' | 'agents',
    name: string,
    projectTargets: Map<string, Target>,
    alias: Map<string, string>,
    backupDir: string,
  ): Promise<void> {
    const entryPath = folder === 'skills' ? join(source.dataDir, folder, name) : join(source.dataDir, folder, `${name}.md`);
    const mdPath = folder === 'skills' ? join(entryPath, 'SKILL.md') : entryPath;
    let doc: { frontmatter: Record<string, unknown>; body: string };
    try {
      doc = parseMarkdown<Record<string, unknown>>(await this.deps.fs.readFile(mdPath));
    } catch (err) {
      this.note('3', `Skipped unreadable entity: ${err instanceof Error ? err.message : String(err)}`, mdPath);
      return;
    }
    const fm = doc.frontmatter;
    const scopes = Array.isArray(fm['scopes']) ? (fm['scopes'] as unknown[]) : ['personal'];
    const scope = scopes[0];
    const scopeId = typeof fm['scopeId'] === 'string' ? fm['scopeId'] : undefined;

    let target: Target;
    if (scope === 'project') {
      target = (scopeId !== undefined ? projectTargets.get(scopeId) : undefined) ?? {
        kind: 'dangling',
        reason: `project '${String(scopeId)}' no longer exists`,
      };
    } else if (scope === 'workspace') {
      // Step 5: the old default workspace's own entities become Global's.
      target = source.ownerId === null
        ? { kind: 'global' }
        : { kind: 'workspace', id: (scopeId !== undefined ? alias.get(scopeId) : undefined) ?? source.ownerId };
    } else {
      // Step 6: a personal entity stored in a workspace's dir belongs to Global.
      target = { kind: 'global' };
    }

    if (target.kind === 'dangling') {
      await this.deps.fs.remove(entryPath);
      this.note('3', `Moved to backup (${target.reason})`, this.backupPathFor(backupDir, entryPath));
      return;
    }

    const rescoped: Record<string, unknown> = { ...fm, scopes: [target.kind === 'global' ? 'personal' : 'workspace'] };
    delete rescoped['scopeId'];
    if (target.kind === 'workspace') rescoped['scopeId'] = target.id;

    const targetDataDir = await this.dataDirFor(target);
    const sameDir = resolve(targetDataDir) === resolve(source.dataDir);
    let finalName = name;
    if (!sameDir) {
      const destinationFor = (n: string): string =>
        folder === 'skills' ? join(targetDataDir, folder, n) : join(targetDataDir, folder, `${n}.md`);
      if (await this.deps.fs.pathExists(destinationFor(name))) {
        if (target.kind === 'global') {
          // Global's copy wins; the stray one survives only in the backup.
          await this.deps.fs.remove(entryPath);
          this.note('6', `Name collision with a Global ${folder.slice(0, -1)} — kept Global's`, this.backupPathFor(backupDir, entryPath));
          return;
        }
        finalName = await this.freeName(name, destinationFor);
        this.note('3', `Renamed '${name}' to '${finalName}' to avoid a collision`, destinationFor(finalName));
      }
    }
    if (finalName !== name) rescoped['name'] = finalName;
    if (sameDir && sameScope(fm, rescoped)) return;

    // Move first, rewrite after: a crash in between leaves either the
    // untouched original or a moved copy that the next run's scan of the
    // target dir rescopes — never a rescoped file still sitting in its old dir.
    let finalMdPath = mdPath;
    if (!sameDir) {
      const destination = folder === 'skills' ? join(targetDataDir, folder, finalName) : join(targetDataDir, folder, `${finalName}.md`);
      await this.move(entryPath, destination);
      finalMdPath = folder === 'skills' ? join(destination, 'SKILL.md') : destination;
    }
    await this.deps.fs.writeFile(finalMdPath, serializeMarkdown(rescoped, doc.body));
    this.touch(target, source);
  }

  /** Step 6 for the personal singleton found in a workspace's data dir. */
  private async migratePersonalInstruction(source: Source, backupDir: string): Promise<void> {
    if (source.ownerId === null) return;
    const path = join(source.dataDir, 'instructions', 'default.md');
    if (!(await this.deps.fs.pathExists(path))) return;
    const destination = join(this.deps.globalDataDir, 'instructions', 'default.md');
    if (await this.deps.fs.pathExists(destination)) {
      await this.deps.fs.remove(path);
      this.note('6', "Personal instruction collision — kept Global's", this.backupPathFor(backupDir, path));
      return;
    }
    await this.move(path, destination);
    this.note('6', 'Moved personal instruction to Global', destination);
  }

  /** Step 4 — one `instructions/project/<slug>/`. */
  private async migrateWorkspaceInstruction(
    source: Source,
    slug: string,
    projectTargets: Map<string, Target>,
    backupDir: string,
  ): Promise<void> {
    const dir = join(source.dataDir, INSTRUCTIONS_PROJECT_SUBDIR, slug);
    const metaPath = join(dir, 'meta.json');
    const meta = await this.readJson(metaPath).catch(() => null);
    if (meta === null) {
      this.note('4', 'Skipped instruction with a missing or unreadable meta.json', dir);
      return;
    }
    const scopeId = typeof meta['scopeId'] === 'string' && meta['scopeId'] !== '' ? meta['scopeId'] : undefined;
    const repoPath = typeof meta['repoPath'] === 'string' && meta['repoPath'] !== '' ? meta['repoPath'] : undefined;

    let target: Target;
    if (meta['scope'] === 'workspace') {
      target = source.ownerId === null
        ? { kind: 'dangling', reason: 'Global has a single personal instruction; a workspace instruction of the old default workspace has no home' }
        : { kind: 'workspace', id: source.ownerId };
    } else if (scopeId !== undefined) {
      target = projectTargets.get(scopeId) ?? { kind: 'dangling', reason: `project '${scopeId}' no longer exists` };
    } else if (repoPath !== undefined) {
      const root = (await this.deps.fs.realDirectory(repoPath)) ?? repoPath;
      target = await this.workspaceForFolder(repoPath, basename(root) || root, deterministicId(root), this.deps.clock.now().toISOString());
    } else {
      this.note('4', 'Skipped instruction with neither scopeId nor repoPath', dir);
      return;
    }
    if (target.kind === 'global') {
      target = { kind: 'dangling', reason: 'a project at the home folder would overwrite the personal instruction' };
    }
    if (target.kind === 'dangling') {
      await this.deps.fs.remove(dir);
      this.note('4', `Moved to backup (${target.reason})`, this.backupPathFor(backupDir, dir));
      return;
    }

    const rewritten: Record<string, unknown> = { ...meta, scope: 'workspace', scopeId: target.id };
    delete rewritten['repoPath'];
    const targetDataDir = await this.dataDirFor(target);
    const sameDir = resolve(targetDataDir) === resolve(source.dataDir);
    const unchanged = sameDir && meta['scope'] === 'workspace' && meta['scopeId'] === target.id && repoPath === undefined;
    if (unchanged) return;

    // Same move-then-rewrite order as `migrateMarkdownEntity`.
    let finalMetaPath = metaPath;
    if (!sameDir) {
      const destinationFor = (s: string): string => join(targetDataDir, INSTRUCTIONS_PROJECT_SUBDIR, s);
      const finalSlug = (await this.deps.fs.pathExists(destinationFor(slug))) ? await this.freeName(slug, destinationFor) : slug;
      if (finalSlug !== slug) this.note('4', `Renamed instruction '${slug}' to '${finalSlug}' to avoid a collision`, destinationFor(finalSlug));
      await this.move(dir, destinationFor(finalSlug));
      finalMetaPath = join(destinationFor(finalSlug), 'meta.json');
    }
    await this.deps.fs.writeFile(finalMetaPath, `${JSON.stringify(rewritten, null, 2)}\n`);
    this.touch(target, source);
  }

  private async dataDirFor(target: Exclude<Target, { kind: 'dangling' }>): Promise<string> {
    if (target.kind === 'global') return this.deps.globalDataDir;
    const workspace = [...this.kept, ...this.created].find((w) => w.id === target.id);
    if (!workspace) throw new Error(`Unknown target workspace ${target.id}`);
    const dataDir = workspacePath(workspace.rootPath);
    if (!this.bootstrapped.has(workspace.id)) {
      await this.deps.bootstrap.create(dataDir);
      this.bootstrapped.add(workspace.id);
    }
    return dataDir;
  }

  private touch(target: Exclude<Target, { kind: 'dangling' }>, source: Source): void {
    if (target.kind === 'workspace') this.touched.add(target.id);
    if (source.ownerId !== null) this.touched.add(source.ownerId);
  }

  private async freeName(name: string, destinationFor: (n: string) => string): Promise<string> {
    for (let n = 2; ; n++) {
      const candidate = `${name}-${n}`;
      if (!(await this.deps.fs.pathExists(destinationFor(candidate)))) return candidate;
    }
  }

  /** `rename`, falling back to copy + remove across volumes. Never overwrites. */
  private async move(from: string, to: string): Promise<void> {
    if (await this.deps.fs.pathExists(to)) throw new Error(`Refusing to overwrite ${to}`);
    await this.deps.fs.mkdir(dirname(to), { recursive: true });
    try {
      await this.deps.fs.rename(from, to);
    } catch (err) {
      if ((err as { code?: string }).code !== 'EXDEV') throw err;
      await this.copyTree(from, to);
      await this.deps.fs.remove(from);
    }
  }

  private async copyTree(from: string, to: string): Promise<void> {
    const entry = await this.deps.fs.lstat(from);
    if (entry.kind === 'none') return;
    await this.deps.fs.mkdir(dirname(to), { recursive: true });
    if (entry.kind === 'symlink') {
      await this.deps.fs.symlink({ target: await this.deps.fs.readlink(from), path: to });
      return;
    }
    if (entry.kind === 'file') {
      await this.deps.fs.copyFile(from, to);
      return;
    }
    await this.deps.fs.mkdir(to, { recursive: true });
    for (const child of await this.deps.fs.readdir(from)) {
      await this.copyTree(join(from, child), join(to, child));
    }
  }

  private backupPathFor(backupDir: string, path: string): string {
    return join(backupDir, resolve(path).replace(/^[/\\]+/, ''));
  }

  private async listDir(path: string): Promise<string[]> {
    if (!(await this.deps.fs.pathExists(path))) return [];
    return (await this.deps.fs.readdir(path)).filter((name) => !name.startsWith('.'));
  }

  private async readJson(path: string): Promise<Record<string, unknown> | null> {
    if (!(await this.deps.fs.pathExists(path))) return null;
    const parsed: unknown = JSON.parse(await this.deps.fs.readFile(path));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Expected a JSON object in ${path}`);
    }
    return parsed as Record<string, unknown>;
  }

  private async writeLog(backupDir: string): Promise<void> {
    await this.deps.fs.mkdir(backupDir, { recursive: true });
    await this.deps.fs.writeFile(join(backupDir, 'log.json'), `${JSON.stringify(this.log, null, 2)}\n`);
  }

  private note(step: string, message: string, path?: string): void {
    this.log.push(path === undefined ? { step, message } : { step, message, path });
  }
}

function sameScope(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const scopes = (fm: Record<string, unknown>): string => JSON.stringify(fm['scopes'] ?? ['personal']);
  return scopes(a) === scopes(b) && a['scopeId'] === b['scopeId'] && a['name'] === b['name'];
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function stripTrailingSep(path: string): string {
  return path.length > 1 ? path.replace(/[\\/]+$/, '') : path;
}

/** Stable across re-runs, so a crash mid-migration converges instead of minting a second workspace. */
function deterministicId(root: string): string {
  const hex = createHash('sha256').update(root).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
