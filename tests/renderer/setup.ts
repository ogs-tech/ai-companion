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

// jsdom has no layout engine and so no IntersectionObserver either — the
// session history list watches a sentinel element with one to page itself.
// This stub records every instance and never fires on its own, so a test
// decides exactly when the sentinel comes into view by calling
// `intersectionObservers.at(-1).trigger()` rather than racing a real one.
class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = [];
  readonly elements: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
    IntersectionObserverStub.instances.push(this);
  }
  observe(element: Element): void {
    this.elements.push(element);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  /** Simulates the sentinel scrolling into view. */
  trigger(isIntersecting = true): void {
    this.callback([{ isIntersecting }]);
  }
}

if (typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver === 'undefined') {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IntersectionObserverStub;
}

/** Every IntersectionObserver created since the last reset, newest last. */
export const intersectionObservers = IntersectionObserverStub.instances;

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
  IntersectionObserverStub.instances.length = 0;
});
