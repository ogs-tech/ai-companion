import { describe, expect, it } from 'vitest';
import { resolveWindowState } from '../../../../src/main/application/desktop/window-bounds.js';

const display = { x: 0, y: 0, width: 1920, height: 1080 };
const second = { x: 1920, y: 0, width: 1920, height: 1080 };

describe('resolveWindowState', () => {
  it('uses the default size and no position without saved state', () => {
    expect(resolveWindowState(null, [display])).toEqual({ width: 1024, height: 768, maximized: false });
  });

  it('keeps a position that is on a display', () => {
    expect(resolveWindowState({ width: 1000, height: 700, x: 100, y: 80, maximized: true }, [display])).toEqual({
      width: 1000,
      height: 700,
      x: 100,
      y: 80,
      maximized: true,
    });
  });

  it('drops the position when its display is gone, so the window centers', () => {
    const result = resolveWindowState({ width: 1000, height: 700, x: 2200, y: 100, maximized: false }, [display]);
    expect(result.x).toBeUndefined();
    expect(result.y).toBeUndefined();
    expect(result.width).toBe(1000);
  });

  it('keeps a position on a secondary display that is still connected', () => {
    expect(resolveWindowState({ width: 1000, height: 700, x: 2200, y: 100, maximized: false }, [display, second]).x).toBe(2200);
  });

  it('drops a position where only a sliver of the window is visible', () => {
    const result = resolveWindowState({ width: 1000, height: 700, x: 1900, y: 100, maximized: false }, [display]);
    expect(result.x).toBeUndefined();
  });

  it('raises a too-small size to the minimum', () => {
    const result = resolveWindowState({ width: 300, height: 200, maximized: false }, [display]);
    expect(result).toMatchObject({ width: 800, height: 560 });
  });
});
