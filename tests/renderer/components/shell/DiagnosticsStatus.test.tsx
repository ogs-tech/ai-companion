import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiagnosticsStatus } from '../../../../src/renderer/components/shell/DiagnosticsStatus.js';
import * as focus from '../../../../src/renderer/lib/diagnostics-focus.js';
import { registerAreaOpener } from '../../../../src/renderer/lib/workspace-area-store.js';
import type { HealthCheck, HealthReport } from '../../../../src/shared/health.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

const SETTINGS = {
  ui: { theme: 'light' },
  adapters: { claude: { enabled: true }, cursor: { enabled: true }, lmstudio: { enabled: false } },
  language: 'off',
};

const check = (over: Partial<HealthCheck>): HealthCheck => ({
  id: over.id ?? `${over.entityUrn}:${over.channel}`,
  category: 'symlink',
  severity: 'ok',
  title: 't',
  channel: 'claude',
  observedAt: '2026-11-18T14:32:00.000Z',
  ...over,
});

const report = (checks: HealthCheck[]): HealthReport => ({
  generatedAt: '2026-11-18T14:32:00.000Z',
  worst: 'ok',
  counts: { ok: 0, warning: 0, error: 0 },
  checks,
});

let call: CallSpy;
function serve(checks: HealthCheck[]): void {
  call.mockImplementation(async (method: string) => {
    if (method === 'settings.get') return ok(SETTINGS);
    if (method === 'health.getReport') return ok(report(checks));
    if (method === 'adapter.syncAll') return ok([]);
    if (method === 'detected.list') return ok([]);
    return ok(null);
  });
}

beforeEach(() => {
  call = mockApi();
});
afterEach(() => {
  registerAreaOpener(null);
  vi.restoreAllMocks();
});

describe('DiagnosticsStatus', () => {
  it('says Conectado when every channel is connected, and its popover offers only Atualizar', async () => {
    serve([check({ entityUrn: 'urn:skill:tdd' })]);
    renderWithShell(<DiagnosticsStatus />);
    const entry = await screen.findByTestId('status-pill-sync');
    expect(entry).toHaveTextContent('Conectado');
    expect(entry).toHaveAttribute('data-variant', 'ok');

    await userEvent.click(entry);
    const popover = await screen.findByTestId('diagnostics-popover');
    expect(popover).toHaveTextContent('Tudo conectado');
    expect(within(popover).getByTestId('diagnostics-popover-refresh')).toBeInTheDocument();
    expect(within(popover).queryByTestId('diagnostics-popover-open')).not.toBeInTheDocument();
  });

  it('names the worst state with its count, never a list of channels', async () => {
    serve([
      check({ entityUrn: 'urn:skill:tdd', channel: 'cursor', severity: 'warning', cause: 'repointed' }),
      check({ entityUrn: 'urn:plugin:sp', severity: 'error', category: 'config-drift', cause: 'plugin-drift' }),
    ]);
    renderWithShell(<DiagnosticsStatus />);
    const entry = await screen.findByTestId('status-pill-sync');
    expect(entry).toHaveTextContent('1 com erro');
    expect(entry).toHaveAttribute('data-variant', 'error');
    expect(entry).not.toHaveTextContent('Cursor');
  });

  it('lists the problems worst first, and a line deep-links into Diagnóstico for that item', async () => {
    const spy = vi.spyOn(focus, 'openDiagnosticsFor').mockImplementation(() => undefined);
    serve([
      check({ entityUrn: 'urn:skill:tdd', channel: 'cursor', severity: 'warning', cause: 'repointed' }),
      check({ entityUrn: 'urn:plugin:sp', severity: 'error', category: 'config-drift', cause: 'plugin-drift' }),
    ]);
    renderWithShell(<DiagnosticsStatus />);
    await userEvent.click(await screen.findByTestId('status-pill-sync'));
    const popover = await screen.findByTestId('diagnostics-popover');
    expect(popover).toHaveTextContent('1 em alerta · 1 com erro');
    const lines = within(popover).getAllByTestId(/^diagnostics-popover-item-/);
    expect(lines.map((l) => l.textContent)).toEqual(['sp · Plugin — Com erro no Claude', 'tdd · Skill — Em alerta no Cursor']);

    await userEvent.click(within(popover).getByTestId('diagnostics-popover-item-urn:skill:tdd'));
    expect(spy).toHaveBeenCalledWith('urn:skill:tdd', []);
  });

  it('Abrir diagnóstico opens the full screen, without a leftover narrowing', async () => {
    const opener = vi.fn();
    registerAreaOpener(opener);
    const clear = vi.spyOn(focus, 'clearDiagnosticsFocus');
    serve([check({ entityUrn: 'urn:skill:tdd', severity: 'error', cause: 'missing' })]);
    renderWithShell(<DiagnosticsStatus />);
    await userEvent.click(await screen.findByTestId('status-pill-sync'));
    await userEvent.click(await screen.findByTestId('diagnostics-popover-open'));
    expect(clear).toHaveBeenCalled();
    expect(opener).toHaveBeenCalledWith('diagnostico');
  });

  it('Atualizar syncs, re-probes MCP and scans the channels again', async () => {
    serve([check({ entityUrn: 'urn:skill:tdd' })]);
    renderWithShell(<DiagnosticsStatus />);
    await userEvent.click(await screen.findByTestId('status-pill-sync'));
    await userEvent.click(await screen.findByTestId('diagnostics-popover-refresh'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('detected.list', {}));
    const methods = call.mock.calls.map((c) => c[0]);
    expect(methods.indexOf('adapter.syncAll')).toBeLessThan(methods.indexOf('mcp.refreshHealth'));
    expect(methods.indexOf('mcp.refreshHealth')).toBeLessThan(methods.indexOf('detected.list'));
  });

  it('stays silent until the report has loaded', () => {
    call.mockImplementation(() => new Promise(() => undefined));
    renderWithShell(<DiagnosticsStatus />);
    expect(screen.queryByTestId('status-pill-sync')).not.toBeInTheDocument();
  });
});
