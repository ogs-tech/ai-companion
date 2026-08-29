import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no layout engine, so it never implements ResizeObserver — but
// react-resizable-panels (used by WorkspaceScreen) requires one to mount at
// all. A no-op stub is enough since tests never assert on measured pixel
// sizes, only on the panel's collapsed/expanded state.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom's Range has no getClientRects() — CodeMirror 6 (the body editor in
// EditorPanel) calls it during an async, requestAnimationFrame-scheduled
// layout measurement pass, which otherwise throws once that callback fires
// after a test has already unmounted the editor.
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = function (): DOMRectList {
    return { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList;
  };
}

// Any tree row can render a SessionStatusBadge, which calls useSessions(),
// which listens on window.api.session.onAnyExit — so every test that mounts
// one needs at least this much of the preload bridge, even tests that never
// call mockApi() (they only care about a different IPC method). Tests that
// do call mockApi() still get their own window.api, which replaces this.
if (typeof (window as unknown as { api?: unknown }).api === 'undefined') {
  (window as unknown as { api: unknown }).api = {
    call: async () => ({ ok: true, data: undefined }),
    session: {
      onOutput: () => () => {},
      onExit: () => () => {},
      onAnyExit: () => () => {},
    },
  };
}

afterEach(() => {
  cleanup();
});
