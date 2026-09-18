import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { SessionPanel, TERMINAL_NEWLINE_SEQUENCE } from '../../../src/renderer/components/SessionPanel.js';
import { mockApi, ok, renderWithQuery, type CallSpy } from '../test-utils.js';

/**
 * Unlike `session-panel.test.tsx`, this file deliberately does NOT mock `@xterm/xterm`.
 *
 * The mocked suite hands the captured key handler a synthetic object and asserts what the
 * handler returns — which proves the handler's own logic and nothing about whether xterm
 * honours it. It passed green while Shift+Enter was submitting in the real app, because the
 * bug lived in the seam between the two: returning `false` stops xterm's own processing but
 * does not cancel the DOM event, so the legacy `keypress` event still fired and xterm turned
 * its `charCode` 13 back into a `\r`. Only the real terminal can catch that.
 */

class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_callback: ResizeObserverCallback) {}
}

beforeAll(() => {
  // xterm's CoreBrowserService reads devicePixelRatio through matchMedia, which jsdom lacks.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
});

/**
 * Dispatches the event pair a real browser produces for one physical keypress: `keypress`
 * only follows when `keydown` was not cancelled. Modelling that ordering is the whole point —
 * a test that fires `keydown` alone cannot observe the leak.
 */
function pressShiftEnter(textarea: HTMLTextAreaElement): void {
  const init = { key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true, bubbles: true, cancelable: true };
  const keydown = new KeyboardEvent('keydown', init);
  textarea.dispatchEvent(keydown);
  if (!keydown.defaultPrevented) {
    textarea.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: 13 }));
  }
}

async function findTerminalTextarea(): Promise<HTMLTextAreaElement> {
  return waitFor(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('.xterm textarea');
    if (!textarea) throw new Error('terminal textarea not mounted yet');
    return textarea;
  });
}

function writesFor(call: CallSpy): string[] {
  return call.mock.calls
    .filter(([method]) => method === 'session.write')
    .map(([, params]) => (params as { data: string }).data);
}

describe('<SessionPanel> key events against the real xterm', () => {
  let call: CallSpy;

  beforeEach(() => {
    call = mockApi();
    call.mockImplementation(async (method: string) =>
      method === 'session.status'
        ? ok({ sessionId: 'sess-1', status: 'running', outputBuffer: '' })
        : ok(null),
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('writes the newline sequence for Shift+Enter', async () => {
    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} sessionId="sess-1" />);
    pressShiftEnter(await findTerminalTextarea());

    await waitFor(() => expect(writesFor(call)).toContain(TERMINAL_NEWLINE_SEQUENCE));
  });

  it('never lets a carriage return reach the PTY on Shift+Enter', async () => {
    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} sessionId="sess-1" />);
    pressShiftEnter(await findTerminalTextarea());

    await waitFor(() => expect(writesFor(call)).toContain(TERMINAL_NEWLINE_SEQUENCE));
    // A `\r` alongside the newline is what the CLI reads as "submit" — the message goes out
    // mid-compose and the newline is never seen. This is the regression that shipped.
    expect(writesFor(call)).not.toContain('\r');
  });

  it('keeps writing newlines on repeated presses, never a carriage return', async () => {
    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} sessionId="sess-1" />);
    const textarea = await findTerminalTextarea();

    // The reported symptom was positional: the first Shift+Enter broke the line and every one
    // after it submitted. A single-press test cannot see that, so press three times.
    pressShiftEnter(textarea);
    pressShiftEnter(textarea);
    pressShiftEnter(textarea);

    await waitFor(() => expect(writesFor(call)).toHaveLength(3));
    expect(writesFor(call)).toEqual([
      TERMINAL_NEWLINE_SEQUENCE,
      TERMINAL_NEWLINE_SEQUENCE,
      TERMINAL_NEWLINE_SEQUENCE,
    ]);
  });

  it('cancels the DOM event so no legacy keypress can be synthesised', async () => {
    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} sessionId="sess-1" />);
    const textarea = await findTerminalTextarea();

    const keydown = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(keydown);

    expect(keydown.defaultPrevented).toBe(true);
  });

  it('leaves a plain Enter to xterm, which submits it as a carriage return', async () => {
    renderWithQuery(<SessionPanel anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} sessionId="sess-1" />);
    const textarea = await findTerminalTextarea();

    const keydown = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(keydown);

    await waitFor(() => expect(writesFor(call)).toContain('\r'));
    expect(writesFor(call)).not.toContain(TERMINAL_NEWLINE_SEQUENCE);
  });
});
