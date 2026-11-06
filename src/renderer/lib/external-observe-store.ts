/** Which external session a clicked notification asked to observe; the sessions list opens its read-only view for it. */
let requested: string | null = null;
const listeners = new Set<() => void>();

export function requestObserve(id: string | null): void {
  requested = id;
  for (const listener of listeners) listener();
}

export function subscribeObserve(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getObserveRequest(): string | null {
  return requested;
}
