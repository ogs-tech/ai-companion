import { describe, it, expect, vi, afterEach } from 'vitest';
import { electronFocusSetup } from '../../../src/renderer/lib/query-client.js';

/** jsdom defines `visibilityState` on Document.prototype, so shadow it with an own property. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('electronFocusSetup', () => {
  it('reports focused on the window focus event, which is what an app switch gives an Electron renderer', () => {
    const onFocusChange = vi.fn();
    const stop = electronFocusSetup(onFocusChange);
    window.dispatchEvent(new Event('focus'));
    expect(onFocusChange).toHaveBeenCalledWith(true);
    stop();
  });

  it('reports blurred on the window blur event', () => {
    const onFocusChange = vi.fn();
    const stop = electronFocusSetup(onFocusChange);
    window.dispatchEvent(new Event('blur'));
    expect(onFocusChange).toHaveBeenCalledWith(false);
    stop();
  });

  it('still tracks visibilitychange, the minimize/restore path react-query covers on its own', () => {
    const onFocusChange = vi.fn();
    const stop = electronFocusSetup(onFocusChange);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onFocusChange).toHaveBeenLastCalledWith(false);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onFocusChange).toHaveBeenLastCalledWith(true);

    stop();
  });

  it('removes every listener when the returned cleanup runs', () => {
    const onFocusChange = vi.fn();
    electronFocusSetup(onFocusChange)();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onFocusChange).not.toHaveBeenCalled();
  });
});
