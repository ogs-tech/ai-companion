import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { mockApi, ok, renderWithQuery, type CallSpy } from '../test-utils.js';
import { SessionStatusBadge } from '../../../src/renderer/components/SessionStatusBadge.js';
import type { SessionSnapshot } from '../../../src/shared/session.js';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: 'entity:urn:skill:foo',
    harness: 'claude',
    conversationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    anchor: { kind: 'entity', urn: 'urn:skill:foo' },
    scopeId: null,
    cwd: '/repos/acme',
    label: 'foo',
    status: 'running',
    browserEnabled: false,
    ...overrides,
  };
}

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
});

describe('SessionStatusBadge', () => {
  it('renders nothing when the anchor has no known session', async () => {
    call.mockImplementation(async () => ok([]));
    const { container } = renderWithQuery(<SessionStatusBadge anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('session.list', {}));
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['running', undefined, 'Ocioso', 'idle'],
    ['running', 'working', 'Trabalhando', 'working'],
    ['running', 'needs-input', 'Pergunta', 'needs-input'],
    ['exited', undefined, 'Fechado', 'exited'],
  ] as const)('shows the %s/%s session as "%s"', async (status, activity, label, state) => {
    call.mockImplementation(async () => ok([snapshot({ status, ...(activity ? { activity } : {}) })]));
    renderWithQuery(<SessionStatusBadge anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    const badge = await screen.findByTestId('session-status-entity:urn:skill:foo');
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute('data-state', state);
  });

  it('shows the most urgent state when several sessions share the anchor', async () => {
    const anchor = { kind: 'workspace', workspaceId: 'w1' } as const;
    call.mockImplementation(async () =>
      ok([
        snapshot({ sessionId: 'a', anchor, status: 'exited' }),
        snapshot({ sessionId: 'b', anchor, status: 'running', activity: 'working' }),
        snapshot({ sessionId: 'c', anchor, status: 'running', activity: 'needs-input' }),
      ]),
    );
    renderWithQuery(<SessionStatusBadge anchor={anchor} />);
    expect(await screen.findByText('Pergunta')).toBeInTheDocument();
  });
});
