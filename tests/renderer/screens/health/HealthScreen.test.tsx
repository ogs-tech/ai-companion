import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HealthScreen } from '../../../../src/renderer/screens/health/HealthScreen.js';
import { clearDiagnosticsFocus, openDiagnosticsFor } from '../../../../src/renderer/lib/diagnostics-focus.js';
import type { HealthCheck, HealthReport } from '../../../../src/shared/health.js';
import type { SyncResult } from '../../../../src/shared/sync-result.js';
import { mockApi, ok, fail, renderWithQuery, type CallSpy } from '../../test-utils.js';

const SETTINGS = {
  ui: { theme: 'light' },
  adapters: { claude: { enabled: true }, cursor: { enabled: true }, lmstudio: { enabled: false } },
  language: 'off',
};

/** `channel: undefined` builds a check about no channel. */
const check = (over: { [K in keyof HealthCheck]?: HealthCheck[K] | undefined }): HealthCheck => ({
  id: over.id ?? `${over.category ?? 'symlink'}:${over.channel ?? 'claude'}:${over.entityUrn}`,
  category: 'symlink',
  severity: 'ok',
  title: 't',
  channel: 'claude',
  observedAt: '2026-11-18T14:32:00.000Z',
  ...over,
}) as HealthCheck;

const report = (checks: HealthCheck[]): HealthReport => ({
  generatedAt: '2026-11-18T14:32:00.000Z',
  worst: 'ok',
  counts: { ok: 0, warning: 0, error: 0 },
  checks,
});

const TDD_CURSOR = check({
  entityUrn: 'urn:skill:tdd',
  channel: 'cursor',
  severity: 'error',
  cause: 'repointed',
  target: '/h/.cursor/skills/tdd',
  expected: '/h/.air-ide/skills/tdd',
});

const CHECKS: HealthCheck[] = [
  check({ entityUrn: 'urn:skill:tdd' }),
  TDD_CURSOR,
  check({ entityUrn: 'urn:skill:review' }),
  check({ entityUrn: 'urn:skill:review', channel: 'cursor', coveredBy: 'claude' }),
  check({ entityUrn: 'urn:mcp:github', category: 'mcp-auth', severity: 'warning', cause: 'needs-auth', target: 'github' }),
  check({ entityUrn: 'urn:instruction:default', category: 'generated-file' }),
];

let call: CallSpy;
function serve(checks: HealthCheck[], extra: (method: string, params: unknown) => unknown = () => undefined): void {
  call.mockImplementation(async (method: string, params: unknown) => {
    const handled = extra(method, params);
    if (handled !== undefined) return handled;
    if (method === 'settings.get') return ok(SETTINGS);
    if (method === 'health.getReport') return ok(report(checks));
    if (method === 'adapter.syncAll') return ok([]);
    if (method === 'detected.list') return ok([]);
    if (method === 'mcp.list') return ok([]);
    return ok(null);
  });
}

beforeEach(() => {
  call = mockApi();
});
afterEach(() => {
  act(() => clearDiagnosticsFocus());
});

describe('<HealthScreen> matrix', () => {
  it('lays customizations out in tree order, one column per channel that is on, with the three state words', async () => {
    serve(CHECKS);
    renderWithQuery(<HealthScreen />);
    const matrix = await screen.findByTestId('health-matrix');
    const headers = within(matrix).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Customização', 'Claude', 'Cursor']);
    const groups = within(matrix).getAllByTestId(/^health-group-/).map((g) => g.textContent);
    expect(groups).toEqual(['Instruções', 'Skills', 'MCP']);

    expect(screen.getByTestId('health-cell-urn:skill:tdd-claude')).toHaveTextContent('Conectado');
    expect(screen.getByTestId('health-cell-urn:skill:tdd-cursor')).toHaveTextContent('Com erro');
    expect(screen.getByTestId('health-cell-urn:mcp:github-claude')).toHaveTextContent('Em alerta');
    // Nothing checked there: no state is claimed
    expect(screen.getByTestId('health-cell-urn:mcp:github-cursor')).toHaveTextContent('—');
    expect(screen.getByRole('heading', { name: 'Diagnóstico' }).parentElement).toHaveTextContent('1 em alerta · 1 com erro');
  });

  it('shows connected customizations too — the full picture, not only problems', async () => {
    serve(CHECKS);
    renderWithQuery(<HealthScreen />);
    expect(await screen.findByTestId('health-row-urn:skill:review')).toBeInTheDocument();
    expect(screen.getByTestId('health-row-urn:instruction:default')).toBeInTheDocument();
  });

  it('a click on a cell explains it in place: what happened, where, when, and one action', async () => {
    serve(CHECKS);
    renderWithQuery(<HealthScreen />);
    await userEvent.click(await screen.findByTestId('health-cell-urn:skill:tdd-cursor'));
    const detail = screen.getByTestId('health-detail');
    expect(detail).toHaveTextContent('Com erro — Skill tdd no Cursor');
    expect(detail).toHaveTextContent('O link foi alterado fora do app e aponta para outro lugar.');
    expect(detail).toHaveTextContent('/h/.cursor/skills/tdd');
    expect(detail).toHaveTextContent('deveria apontar para /h/.air-ide/skills/tdd');
    expect(detail).toHaveTextContent(/Verificado às \d{2}:\d{2}/);
    expect(detail).not.toHaveTextContent('Symlink');
    expect(within(detail).getAllByRole('button').map((b) => b.textContent)).toEqual(['Sincronizar Cursor']);

    await userEvent.click(screen.getByTestId('health-cell-urn:skill:tdd-cursor'));
    expect(screen.queryByTestId('health-detail')).not.toBeInTheDocument();
  });

  it('Sincronizar syncs that channel only', async () => {
    serve(CHECKS);
    renderWithQuery(<HealthScreen />);
    await userEvent.click(await screen.findByTestId('health-cell-urn:skill:tdd-cursor'));
    await userEvent.click(screen.getByTestId('health-detail-action'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('adapter.syncAll', { adapterId: 'cursor' }));
  });

  it('a covered channel says whose file it uses, and fixing it syncs that channel', async () => {
    serve([
      check({ entityUrn: 'urn:skill:review', severity: 'error', cause: 'missing' }),
      check({ entityUrn: 'urn:skill:review', channel: 'cursor', coveredBy: 'claude', severity: 'error', cause: 'missing' }),
    ]);
    renderWithQuery(<HealthScreen />);
    await userEvent.click(await screen.findByTestId('health-cell-urn:skill:review-cursor'));
    expect(screen.getByTestId('health-detail')).toHaveTextContent('O Cursor usa o arquivo do Claude; este é o estado dele.');
    await userEvent.click(screen.getByTestId('health-detail-action'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('adapter.syncAll', { adapterId: 'claude' }));
  });

  it('a file of the user in the way offers Instalar por cima, with Desfazer', async () => {
    serve([check({ entityUrn: 'urn:skill:tdd', severity: 'warning', cause: 'unmanaged', target: '/h/.claude/skills/tdd' })], (method) =>
      method === 'adapter.install' ? ok({ undoToken: 'u1' }) : undefined,
    );
    renderWithQuery(<HealthScreen />);
    await userEvent.click(await screen.findByTestId('health-cell-urn:skill:tdd-claude'));
    expect(screen.getByTestId('health-detail-action')).toHaveTextContent('Instalar por cima');
    await userEvent.click(screen.getByTestId('health-detail-action'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('adapter.install', { urn: 'urn:skill:tdd', adapterId: 'claude' }));
    expect(await screen.findByRole('button', { name: 'Desfazer' })).toBeInTheDocument();
  });

  it('a cause no button fixes gets a hint and no button', async () => {
    serve([check({ entityUrn: 'urn:plugin:sp', category: 'config-drift', severity: 'warning', cause: 'plugin-drift', detail: 'not_cached' })]);
    renderWithQuery(<HealthScreen />);
    await userEvent.click(await screen.findByTestId('health-cell-urn:plugin:sp-claude'));
    expect(screen.getByTestId('health-detail')).toHaveTextContent('claude plugin install');
    expect(screen.queryByTestId('health-detail-action')).not.toBeInTheDocument();
  });

  it('an older report without causes still reads, from its own title and remediation', async () => {
    serve([check({ entityUrn: 'urn:skill:tdd', severity: 'error', title: 'Symlink missing: /x', remediation: 'Re-sync.' })]);
    renderWithQuery(<HealthScreen />);
    await userEvent.click(await screen.findByTestId('health-cell-urn:skill:tdd-claude'));
    expect(screen.getByTestId('health-detail')).toHaveTextContent('Symlink missing: /x');
    expect(screen.getByTestId('health-detail')).toHaveTextContent('Re-sync.');
  });

  it('checks about no customization are listed above the matrix', async () => {
    serve([check({ id: 'collector-error:symlink', channel: undefined, severity: 'error', cause: 'collector-failed', detail: 'EACCES' }), ...CHECKS]);
    renderWithQuery(<HealthScreen />);
    const general = await screen.findByTestId('health-general');
    expect(general).toHaveTextContent('Não foi possível verificar esta parte.');
    expect(general).toHaveTextContent('EACCES');
  });

  it('with no channel on, says how to turn one on', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'settings.get') return ok({ ...SETTINGS, adapters: { claude: { enabled: false }, cursor: { enabled: false }, lmstudio: { enabled: false } } });
      if (method === 'health.getReport') return ok(report([]));
      return ok(null);
    });
    renderWithQuery(<HealthScreen />);
    expect(await screen.findByTestId('health-empty')).toHaveTextContent('Ligue um em Configurações › Canais');
  });
});

describe('<HealthScreen> deep link', () => {
  it('narrows to the item and opens its first problem; Ver tudo brings the rest back', async () => {
    serve(CHECKS);
    act(() => openDiagnosticsFor('urn:skill:tdd'));
    renderWithQuery(<HealthScreen />);
    expect(await screen.findByTestId('health-detail')).toHaveTextContent('Skill tdd no Cursor');
    expect(screen.queryByTestId('health-row-urn:mcp:github')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('health-focus-clear'));
    expect(screen.getByTestId('health-row-urn:mcp:github')).toBeInTheDocument();
  });
});

describe('<HealthScreen> Atualizar', () => {
  it('does not sync on mount', async () => {
    serve(CHECKS);
    renderWithQuery(<HealthScreen />);
    await screen.findByTestId('health-matrix');
    expect(call.mock.calls.map((c) => c[0])).not.toContain('adapter.syncAll');
  });

  it('syncs, re-probes MCP, scans the channels, and sums it up with what can be imported', async () => {
    const results: SyncResult[] = [
      { adapter: 'claude', destination: '/a', status: 'ok' },
      { adapter: 'claude', destination: '/b', status: 'conflict', details: { backupPath: '/b.bak' } },
    ];
    serve(CHECKS, (method) => {
      if (method === 'adapter.syncAll') return ok(results);
      if (method === 'detected.list') return ok([{ id: 'd1', importable: true }, { id: 'd2', importable: true }, { id: 'd3', importable: false }]);
      return undefined;
    });
    renderWithQuery(<HealthScreen />);
    await userEvent.click(await screen.findByTestId('health-refresh'));
    const summary = await screen.findByTestId('health-sync-summary');
    expect(summary).toHaveTextContent(/Sincronizado às \d{2}:\d{2}/);
    expect(summary).toHaveTextContent('1 arquivo substituído com backup');
    expect(summary).toHaveTextContent('2 itens detectados nos canais para importar');
    expect(call).toHaveBeenCalledWith('mcp.refreshHealth', {});
  });

  it('still refetches the report when the sync fails', async () => {
    serve(CHECKS, (method) => (method === 'adapter.syncAll' ? fail('internal', 'boom') : undefined));
    renderWithQuery(<HealthScreen />);
    await screen.findByTestId('health-matrix');
    const before = call.mock.calls.filter((c) => c[0] === 'health.getReport').length;
    await userEvent.click(screen.getByTestId('health-refresh'));
    await waitFor(() => expect(call.mock.calls.filter((c) => c[0] === 'health.getReport').length).toBeGreaterThan(before));
  });
});
