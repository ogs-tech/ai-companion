import type { WindowState } from '../ports/window-state-port.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 560;
export const DEFAULT_WINDOW_WIDTH = 1024;
export const DEFAULT_WINDOW_HEIGHT = 768;

/** A window needs at least this much of itself on a display to be reachable with the mouse. */
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 50;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Structural check for a parsed JSON file; drops a half-specified position. Returns `null` when width/height are unusable. */
export function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isFiniteNumber(r['width']) || !isFiniteNumber(r['height'])) return null;
  const state: WindowState = {
    width: Math.round(r['width']),
    height: Math.round(r['height']),
    maximized: r['maximized'] === true,
  };
  if (isFiniteNumber(r['x']) && isFiniteNumber(r['y'])) {
    state.x = Math.round(r['x']);
    state.y = Math.round(r['y']);
  }
  return state;
}

const overlaps = (window: Rect, display: Rect): boolean => {
  const w = Math.min(window.x + window.width, display.x + display.width) - Math.max(window.x, display.x);
  const h = Math.min(window.y + window.height, display.y + display.height) - Math.max(window.y, display.y);
  return w >= MIN_VISIBLE_WIDTH && h >= MIN_VISIBLE_HEIGHT;
};

/**
 * Turns a persisted state into the state to create the window with: size is clamped to the minimum,
 * and a position no display shows (monitor removed, resolution changed) is dropped so the window centers.
 */
export function resolveWindowState(saved: WindowState | null, displays: readonly Rect[]): WindowState {
  if (saved === null) return { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT, maximized: false };
  const width = Math.max(saved.width, MIN_WINDOW_WIDTH);
  const height = Math.max(saved.height, MIN_WINDOW_HEIGHT);
  const resolved: WindowState = { width, height, maximized: saved.maximized };
  if (saved.x !== undefined && saved.y !== undefined) {
    const rect = { x: saved.x, y: saved.y, width, height };
    if (displays.some((display) => overlaps(rect, display))) {
      resolved.x = saved.x;
      resolved.y = saved.y;
    }
  }
  return resolved;
}
