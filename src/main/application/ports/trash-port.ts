/** Sends files to the OS trash (recoverable) — the app never hard-deletes user files. */
export interface TrashPort {
  trash(absPath: string): Promise<void>;
}
