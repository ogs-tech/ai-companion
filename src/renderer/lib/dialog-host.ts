/**
 * A tiny module-scoped queue of blocking questions ("save your changes?",
 * "end running terminals?") answered by `DialogHost`. It replaces `window.confirm`
 * so callers outside React (the unsaved-tabs guard, the quit handler) can
 * `await` a styled dialog. One dialog shows at a time; the rest wait their turn.
 */

export type UnsavedDecision = 'save' | 'discard' | 'cancel';

export interface TrashDecision {
  confirmed: boolean;
  /** "Não perguntar novamente" was ticked together with a confirmation. */
  dontAskAgain: boolean;
}

export interface ConflictQuestion {
  /** Name of the item that already exists at the destination. */
  name: string;
  /** A file and a folder with the same name: "Substituir" is never offered. */
  kindMismatch: boolean;
  /** How many more conflicts follow this one in the same operation (drives "Aplicar a todos"). */
  remaining: number;
}

export interface ConflictDecision {
  resolution: 'replace' | 'keep-both' | 'skip';
  applyToAll: boolean;
}

export type DialogRequest =
  | { kind: 'unsaved'; names: readonly string[]; resolve: (decision: UnsavedDecision) => void }
  | { kind: 'trash'; names: readonly string[]; resolve: (decision: TrashDecision) => void }
  | { kind: 'conflict'; question: ConflictQuestion; resolve: (decision: ConflictDecision | null) => void }
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string; resolve: (confirmed: boolean) => void };

const queue: DialogRequest[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function enqueue(request: DialogRequest): void {
  queue.push(request);
  emit();
}

/** Asks what to do with the named dirty tabs: Salvar / Não salvar / Cancelar. */
export function askUnsaved(names: readonly string[]): Promise<UnsavedDecision> {
  return new Promise((resolve) => enqueue({ kind: 'unsaved', names, resolve }));
}

/** A two-button confirmation. Resolves `false` on Cancelar, Esc or backdrop click. */
export function askConfirm(options: { title: string; message: string; confirmLabel: string }): Promise<boolean> {
  return new Promise((resolve) => enqueue({ kind: 'confirm', ...options, resolve }));
}

/** "Mover para a lixeira?" for the named items, with a "Não perguntar novamente" checkbox. */
export function askTrash(names: readonly string[]): Promise<TrashDecision> {
  return new Promise((resolve) => enqueue({ kind: 'trash', names, resolve }));
}

/** Substituir / Manter ambos / Pular for one name conflict; `null` = the user cancelled the whole operation. */
export function askConflict(question: ConflictQuestion): Promise<ConflictDecision | null> {
  return new Promise((resolve) => enqueue({ kind: 'conflict', question, resolve }));
}

/** Called by `DialogHost` once the user answered; removes the head request. */
export function settleCurrentDialog(): void {
  queue.shift();
  emit();
}

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The request being shown, or `null`. Referentially stable between changes. */
export function getCurrentDialog(): DialogRequest | null {
  return queue[0] ?? null;
}
