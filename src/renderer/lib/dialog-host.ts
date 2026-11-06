/**
 * A tiny module-scoped queue of blocking questions ("save your changes?",
 * "end running terminals?") answered by `DialogHost`. It replaces `window.confirm`
 * so callers outside React (the unsaved-tabs guard, the quit handler) can
 * `await` a styled dialog. One dialog shows at a time; the rest wait their turn.
 */

export type UnsavedDecision = 'save' | 'discard' | 'cancel';

export type DialogRequest =
  | { kind: 'unsaved'; names: readonly string[]; resolve: (decision: UnsavedDecision) => void }
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
