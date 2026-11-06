import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import type { FileOperationsPort, FsEntryKind } from '../ports/file-operations-port.js';
import type { TrashPort } from '../ports/trash-port.js';
import type { FileBrowserService, LocatedPath } from './file-browser-service.js';
import type { ExternalFileService } from './external-file-service.js';
import { describeFsError } from './fs-error-message.js';
import { DomainError } from '../../domain/errors.js';
import {
  DEFAULT_IGNORED_DIRS,
  type ConflictResolution,
  type TransferConflict,
  type TransferFailure,
  type TransferMode,
  type TransferRecord,
  type TransferRequest,
  type TransferResult,
  type TrashResult,
  type UndoTransferResult,
} from '../../../shared/file-ops.js';

export const LIST_FILES_CAP = 20000;
const IGNORED: ReadonlySet<string> = new Set(DEFAULT_IGNORED_DIRS);

const joinRel = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);

function assertValidName(name: string): void {
  if (name.trim() === '' || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new DomainError('validation', 'Nome inválido. Use um nome sem "/" e diferente de "." e "..".', { reason: 'invalid-name' });
  }
}

/** `logo.png` + ` copy` → `logo copy.png`; folders and dotfiles keep the whole name as the stem. */
function withSuffix(name: string, kind: 'file' | 'dir', suffix: string): string {
  const ext = kind === 'file' ? extname(name) : '';
  return `${name.slice(0, name.length - ext.length)}${suffix}${ext}`;
}

/**
 * Create / rename / duplicate / trash / move / copy on the open workspace's
 * files, plus the flat file list quick open uses. Paths arrive workspace-
 * relative and go through `FileBrowserService.locate` — the same alias routing
 * and containment guard as reads — so single and multi-folder behave alike.
 */
export class FileOperationsService {
  constructor(
    private readonly browser: FileBrowserService,
    private readonly ops: FileOperationsPort,
    private readonly trashPort: TrashPort,
    private readonly external: ExternalFileService,
  ) {}

  private async locateItem(path: string): Promise<LocatedPath> {
    const located = await this.browser.locate(path);
    if (located.rel === '') {
      throw new DomainError('validation', 'Não é possível alterar a pasta raiz do workspace.', { reason: 'root' });
    }
    return located;
  }

  private async requireParentDir(abs: string): Promise<void> {
    const parent = await this.ops.stat(dirname(abs));
    if (parent?.kind !== 'dir') throw new DomainError('validation', 'A pasta de destino não existe.', { reason: 'parent-missing' });
  }

  private async createEntry(path: string, create: (abs: string) => Promise<void>): Promise<void> {
    const located = await this.locateItem(path);
    assertValidName(basename(located.abs));
    await this.requireParentDir(located.abs);
    try {
      await create(located.abs);
    } catch (err) {
      if ((err as { code?: string }).code === 'EEXIST') {
        throw new DomainError('validation', 'Já existe um item com esse nome.', { reason: 'exists' });
      }
      throw new DomainError('validation', describeFsError(err));
    }
  }

  async createFile(path: string): Promise<void> {
    await this.createEntry(path, (abs) => this.ops.createFile(abs));
  }

  async createDir(path: string): Promise<void> {
    await this.createEntry(path, (abs) => this.ops.mkdir(abs));
  }

  async rename(path: string, newName: string): Promise<{ path: string }> {
    assertValidName(newName);
    const located = await this.locateItem(path);
    const oldName = basename(located.abs);
    const target = join(dirname(located.abs), newName);
    const caseOnly = newName !== oldName && newName.toLowerCase() === oldName.toLowerCase();
    if (newName === oldName) return { path };
    if (!caseOnly && (await this.ops.stat(target)) !== null) {
      throw new DomainError('validation', 'Já existe um item com esse nome.', { reason: 'exists' });
    }
    try {
      await this.ops.rename(located.abs, target);
    } catch (err) {
      throw new DomainError('validation', describeFsError(err));
    }
    const parts = path.split('/').filter((seg) => seg !== '');
    parts[parts.length - 1] = newName;
    return { path: parts.join('/') };
  }

  async duplicate(path: string): Promise<{ path: string }> {
    const located = await this.locateItem(path);
    const stat = await this.ops.stat(located.abs);
    if (stat === null) throw new DomainError('not_found', 'O item não existe mais.');
    const kind = stat.kind === 'dir' ? 'dir' : 'file';
    const name = basename(located.abs);
    const copyName = await this.uniqueName(dirname(located.abs), name, kind, 'copy');
    try {
      await this.ops.copy(located.abs, join(dirname(located.abs), copyName));
    } catch (err) {
      throw new DomainError('validation', describeFsError(err));
    }
    const parts = path.split('/').filter((seg) => seg !== '');
    parts[parts.length - 1] = copyName;
    return { path: parts.join('/') };
  }

  /** Items that fail are reported; the rest still go to the trash. */
  async trash(paths: string[]): Promise<TrashResult> {
    const failed: TransferFailure[] = [];
    for (const path of paths) {
      try {
        const located = await this.locateItem(path);
        await this.trashPort.trash(located.abs);
      } catch (err) {
        failed.push({ path, message: describeFsError(err) });
      }
    }
    return { failed };
  }

  /** "name copy.ext", "name copy 2.ext" … or, for keep-both, "name 2.ext", "name 3.ext" …. */
  private async uniqueName(dirAbs: string, name: string, kind: 'file' | 'dir', style: 'copy' | 'number'): Promise<string> {
    for (let n = 1; ; n++) {
      const suffix = style === 'copy' ? (n === 1 ? ' copy' : ` copy ${n}`) : ` ${n + 1}`;
      const candidate = withSuffix(name, kind, suffix);
      if ((await this.ops.stat(join(dirAbs, candidate))) === null) return candidate;
    }
  }

  // ---- transfer -----------------------------------------------------------

  async planTransfer(request: TransferRequest): Promise<{ conflicts: TransferConflict[] }> {
    const run = await this.runTransfer(request, true);
    return { conflicts: run.conflicts };
  }

  async transfer(request: TransferRequest): Promise<TransferResult> {
    const { done, failed } = await this.runTransfer(request, false);
    return { done, failed };
  }

  private async runTransfer(request: TransferRequest, dryRun: boolean) {
    const conflicts: TransferConflict[] = [];
    const done: TransferRecord[] = [];
    const failed: TransferFailure[] = [];
    const external = request.external === true;
    const target = await this.browser.locate(request.targetDir);
    const targetStat = await this.ops.stat(target.abs);
    if (targetStat?.kind !== 'dir') throw new DomainError('validation', 'A pasta de destino não existe.', { reason: 'target-missing' });
    const targetRel = request.targetDir.split('/').filter((seg) => seg !== '').join('/');

    for (const source of request.sources) {
      try {
        let srcAbs: string;
        let mode: TransferMode = request.mode;
        if (external) {
          if (!isAbsolute(source) || !this.external.isGranted(source)) {
            throw new DomainError('validation', 'Este arquivo não foi autorizado. Abra-o pelo seletor ou arraste-o para o app.', { reason: 'not-granted' });
          }
          srcAbs = resolve(source);
          mode = 'copy';
        } else {
          const located = await this.locateItem(source);
          srcAbs = located.abs;
          if (located.root !== target.root) mode = 'copy';
        }
        const stat = await this.ops.stat(srcAbs);
        if (stat === null) throw new DomainError('not_found', 'O item não existe mais.');
        const kind = stat.kind === 'dir' ? 'dir' : 'file';
        if (kind === 'dir' && (target.abs === srcAbs || target.abs.startsWith(`${srcAbs}${sep}`))) {
          throw new DomainError('validation', 'Não é possível mover ou copiar uma pasta para dentro dela mesma.', { reason: 'into-itself' });
        }
        await this.place(
          { srcAbs, srcRel: external ? srcAbs : source, kind, destDirAbs: target.abs, destDirRel: targetRel, name: basename(srcAbs), mode },
          { request, dryRun, conflicts, done, failed },
        );
      } catch (err) {
        failed.push({ path: source, message: describeFsError(err) });
      }
    }
    return { conflicts, done, failed };
  }

  private async place(item: PlaceItem, ctx: PlaceContext): Promise<void> {
    const { srcAbs, srcRel, kind, destDirAbs, destDirRel, name, mode } = item;
    const destAbs = join(destDirAbs, name);
    const destRel = joinRel(destDirRel, name);
    const kindLabel: 'file' | 'dir' = kind;

    if (destAbs === srcAbs) {
      if (mode === 'move') return;
      // Copying onto itself is a duplicate: no conflict to ask about.
      const copyName = await this.uniqueName(destDirAbs, name, kindLabel, 'copy');
      if (!ctx.dryRun) await this.perform(item, join(destDirAbs, copyName), joinRel(destDirRel, copyName), false, ctx);
      return;
    }

    const existing = await this.ops.stat(destAbs);
    if (existing === null) {
      if (!ctx.dryRun) await this.perform(item, destAbs, destRel, false, ctx);
      return;
    }

    const existingKind: 'file' | 'dir' = existing.kind === 'dir' ? 'dir' : 'file';
    if (kind === 'dir' && existingKind === 'dir') {
      // Merge: only colliding files are conflicts.
      for (const child of await this.ops.readDir(srcAbs)) {
        const childKind: FsEntryKind = child.kind;
        try {
          await this.place(
            {
              srcAbs: join(srcAbs, child.name),
              srcRel: isAbsolute(srcRel) ? join(srcRel, child.name) : joinRel(srcRel, child.name),
              kind: childKind === 'dir' ? 'dir' : 'file',
              destDirAbs: destAbs,
              destDirRel: destRel,
              name: child.name,
              mode,
            },
            ctx,
          );
        } catch (err) {
          ctx.failed.push({ path: joinRel(srcRel, child.name), message: describeFsError(err) });
        }
      }
      if (mode === 'move' && !ctx.dryRun) await this.ops.removeEmptyDir(srcAbs).catch(() => undefined);
      return;
    }

    if (ctx.dryRun) {
      ctx.conflicts.push({ source: srcRel, target: destRel, sourceKind: kindLabel, targetKind: existingKind });
      return;
    }
    const resolution: ConflictResolution | undefined = ctx.request.resolutions?.[destRel];
    if (resolution === 'replace') {
      if (kindLabel !== existingKind) {
        throw new DomainError('validation', 'Um arquivo e uma pasta com o mesmo nome não podem se substituir. Mantenha os dois ou pule.', { reason: 'kind-clash' });
      }
      await this.trashPort.trash(destAbs);
      await this.perform(item, destAbs, destRel, true, ctx);
    } else if (resolution === 'keep-both') {
      const newName = await this.uniqueName(destDirAbs, name, kindLabel, 'number');
      await this.perform(item, join(destDirAbs, newName), joinRel(destDirRel, newName), false, ctx);
    }
    // 'skip' or unanswered: leave both alone.
  }

  private async perform(item: PlaceItem, destAbs: string, destRel: string, replaced: boolean, ctx: PlaceContext): Promise<void> {
    if (item.mode === 'move') {
      try {
        await this.ops.rename(item.srcAbs, destAbs);
      } catch (err) {
        if ((err as { code?: string }).code !== 'EXDEV') throw err;
        // Different volumes: copy, then send the original to the trash (never delete).
        await this.ops.copy(item.srcAbs, destAbs);
        await this.trashPort.trash(item.srcAbs);
      }
    } else {
      await this.ops.copy(item.srcAbs, destAbs);
    }
    ctx.done.push({ mode: item.mode, from: item.srcRel, to: destRel, replaced });
  }

  async undoTransfer(records: TransferRecord[]): Promise<UndoTransferResult> {
    const failed: TransferFailure[] = [];
    let undone = 0;
    for (const record of [...records].reverse()) {
      try {
        const current = await this.locateItem(record.to);
        if ((await this.ops.stat(current.abs)) === null) {
          throw new DomainError('validation', `"${record.to}" não está mais lá, então não dá para desfazer.`, { reason: 'state-changed' });
        }
        if (record.mode === 'copy') {
          await this.trashPort.trash(current.abs);
        } else {
          const original = await this.locateItem(record.from);
          if ((await this.ops.stat(original.abs)) !== null) {
            throw new DomainError('validation', `Já existe um item em "${record.from}", então não dá para desfazer.`, { reason: 'state-changed' });
          }
          await this.ops.mkdir(dirname(original.abs), { recursive: true });
          await this.ops.rename(current.abs, original.abs);
        }
        undone++;
      } catch (err) {
        failed.push({ path: record.to, message: describeFsError(err) });
      }
    }
    return { undone, failed };
  }

  // ---- flat file list -----------------------------------------------------

  /** Every file as a workspace-relative path (alias-prefixed with several folders), for quick open. */
  async listFiles(): Promise<string[]> {
    const files: string[] = [];
    for await (const file of walkFiles(this.ops, this.browser.roots())) {
      files.push(file.rel);
      if (files.length >= LIST_FILES_CAP) break;
    }
    return files;
  }
}

interface PlaceItem {
  srcAbs: string;
  srcRel: string;
  kind: 'file' | 'dir';
  destDirAbs: string;
  destDirRel: string;
  name: string;
  mode: TransferMode;
}

interface PlaceContext {
  request: TransferRequest;
  dryRun: boolean;
  conflicts: TransferConflict[];
  done: TransferRecord[];
  failed: TransferFailure[];
}

/** Depth-first walk over regular files, skipping the default ignored directories and never following symlinks. */
export async function* walkFiles(
  ops: FileOperationsPort,
  roots: { prefix: string; root: string }[],
): AsyncGenerator<{ rel: string; abs: string }> {
  for (const { prefix, root } of roots) {
    const stack: { abs: string; rel: string }[] = [{ abs: root, rel: prefix }];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = await ops.readDir(dir.abs);
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      const subdirs: { abs: string; rel: string }[] = [];
      for (const entry of entries) {
        if (entry.kind === 'dir') {
          if (!IGNORED.has(entry.name)) subdirs.push({ abs: join(dir.abs, entry.name), rel: joinRel(dir.rel, entry.name) });
        } else if (entry.kind === 'file') {
          yield { abs: join(dir.abs, entry.name), rel: joinRel(dir.rel, entry.name) };
        }
      }
      stack.push(...subdirs.reverse());
    }
  }
}
