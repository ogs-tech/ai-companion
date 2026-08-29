import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { mockApi, ok, renderWithQuery, type CallSpy } from '../test-utils.js';
import { SessionStatusBadge } from '../../../src/renderer/components/SessionStatusBadge.js';
import type { SessionSnapshot } from '../../../src/shared/session.js';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: 'entity:urn:skill:foo',
    anchor: { kind: 'entity', urn: 'urn:skill:foo' },
    cwd: '/repos/acme',
    label: 'foo',
    status: 'running',
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

  it('shows an "Ativa" pill for a running session', async () => {
    call.mockImplementation(async () => ok([snapshot({ status: 'running' })]));
    renderWithQuery(<SessionStatusBadge anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    const pill = await screen.findByTestId('status-pill-session-status-entity:urn:skill:foo');
    expect(pill).toHaveTextContent('Ativa');
    expect(pill).toHaveAttribute('data-variant', 'running');
  });

  it('shows an "Encerrada" pill for an exited session', async () => {
    call.mockImplementation(async () => ok([snapshot({ status: 'exited' })]));
    renderWithQuery(<SessionStatusBadge anchor={{ kind: 'entity', urn: 'urn:skill:foo' }} />);
    const pill = await screen.findByTestId('status-pill-session-status-entity:urn:skill:foo');
    expect(pill).toHaveTextContent('Encerrada');
    expect(pill).toHaveAttribute('data-variant', 'exited');
  });
});
