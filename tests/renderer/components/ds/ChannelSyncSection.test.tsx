import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

vi.mock('../../../../src/renderer/lib/diagnostics-focus.js', () => ({ openDiagnosticsFor: vi.fn() }));
const { openDiagnosticsFor } = await import('../../../../src/renderer/lib/diagnostics-focus.js');
const { ChannelSyncSection } = await import('../../../../src/renderer/components/ds/ChannelSyncSection.js');

const URN = 'urn:skill:tdd';
const settings = { adapters: { claude: { enabled: true }, cursor: { enabled: true }, lmstudio: { enabled: false } } };
const report = {
  generatedAt: '', worst: 'error', counts: { ok: 1, warning: 0, error: 1 },
  checks: [
    { id: 'a', category: 'symlink', severity: 'ok', title: 't', entityUrn: URN, channel: 'claude', target: '/h/.claude/skills/tdd', observedAt: '' },
    { id: 'b', category: 'generated-file', severity: 'error', title: 'Arquivo divergente', entityUrn: URN, channel: 'cursor', target: '/h/.cursor/rules/tdd.mdc', remediation: 'Sincronize de novo', observedAt: '' },
  ],
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  vi.mocked(openDiagnosticsFor).mockClear();
});

describe('ChannelSyncSection', () => {
  it('renders nothing while the report loads', () => {
    call.mockImplementation(() => new Promise(() => undefined));
    const { container } = renderWithShell(<ChannelSyncSection urn={URN} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the report fails', async () => {
    call.mockImplementation(async (method: string) => (method === 'settings.get' ? ok(settings) : { ok: false, error: { kind: 'internal', message: 'x' } }));
    renderWithShell(<ChannelSyncSection urn={URN} />);
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('health.getReport', expect.anything()));
    expect(screen.queryByTestId('channel-sync')).not.toBeInTheDocument();
  });

  it('lists each channel with its path and state, and Abrir diagnóstico calls openDiagnosticsFor with the urn', async () => {
    call.mockImplementation(async (method: string) => (method === 'settings.get' ? ok(settings) : method === 'health.getReport' ? ok(report) : ok(undefined)));
    renderWithShell(<ChannelSyncSection urn={URN} />);
    expect(await screen.findByText('Sincronização')).toBeInTheDocument();
    expect(screen.getByTestId('channel-sync-claude')).toHaveTextContent('Ligado por link simbólico');
    expect(screen.getByTestId('channel-sync-claude')).toHaveTextContent('/h/.claude/skills/tdd');
    expect(screen.getByTestId('channel-sync-cursor')).toHaveTextContent('Arquivo divergente');
    expect(screen.getByTestId('channel-sync-cursor')).toHaveTextContent('Sincronize de novo');
    expect(screen.getByTestId('channel-sync-lmstudio')).toHaveTextContent('Só roda sessões, não recebe customizações');
    expect(screen.queryByTestId('channel-sync-open-claude')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByTestId('channel-sync-open-cursor'));
    expect(openDiagnosticsFor).toHaveBeenCalledWith(URN);
  });

  it('a disabled entity reads one line', async () => {
    call.mockImplementation(async (method: string) => (method === 'settings.get' ? ok(settings) : method === 'health.getReport' ? ok(report) : ok(undefined)));
    renderWithShell(<ChannelSyncSection urn={URN} entityEnabled={false} />);
    expect(await screen.findByTestId('channel-sync')).toHaveTextContent('Desativado — não vai para nenhum canal');
  });
});
