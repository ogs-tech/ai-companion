export interface WindowState {
  width: number;
  height: number;
  /** Absent when the position is unknown or was dropped: the window is then centered by the OS. */
  x?: number;
  y?: number;
  maximized: boolean;
}

export interface WindowStatePort {
  /** The persisted state, or `null` when missing or unreadable. Values are not yet validated against the displays. */
  load(): WindowState | null;
  /** Synchronous so it can run inside the window's `close` handler. Never throws. */
  save(state: WindowState): void;
}
