import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstructionsScreen } from '../../../../src/renderer/screens/instructions/InstructionsScreen.js';
import { WORKSPACE_SOURCE, type PersonalInstruction, type ProjectInstruction } from '../../../../src/shared/entity.js';
import type { Settings } from '../../../../src/shared/settings.js';
import { mockApi, ok, renderWithQuery, type CallSpy } from '../../test-utils.js';

// InstructionsScreen opens the editor in edit mode for an existing personal
// instruction, which now renders <SessionPanel>. Lightweight mocks — same as
// tests/renderer/components/customization-editor.test.tsx — keep xterm's real
// browser-only Terminal (canvas, matchMedia) out of jsdom.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  },
}));

const meta = { version: '0.1.0', createdAt: '', updatedAt: '' };

const personal: PersonalInstruction = {
  urn: 'urn:instruction:default', kind: 'instruction', name: 'default',
  description: 'personal profile', scopes: ['personal'], metadata: meta,
  source: WORKSPACE_SOURCE, content: '## Section A\n- item\n',
};

const project = (name = 'acme', repoPath = '/repos/acme'): ProjectInstruction => ({
  urn: `urn:instruction:${name}`, kind: 'instruction', name, description: `${name} rules`,
  scopes: ['project'], metadata: meta, source: WORKSPACE_SOURCE,
  content: `# ${name}\n`, repoPath,
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  adapters: { claude: { enabled: true }, cursor: { enabled: false }, ...over.adapters },
  ui: { theme: 'system' },
  language: 'off',
  ...over,
});

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

/**
 * Route the mock IPC by method name. Every test overrides only what it needs.
 * Any unhandled method falls through to `undefined`, which yields the empty
 * default for react-query.
 */
function routeCalls(map: Record<string, unknown>): void {
  call.mockImplementation(async (method: string) => ok(map[method] ?? null));
}

describe('<InstructionsScreen>', () => {
  it('renders empty state for personal + zero project instructions', async () => {
    routeCalls({
      'instruction.list': [],
      'settings.get': settings(),
    });

    renderWithQuery(<InstructionsScreen />);

    await screen.findByTestId('personal-instruction-card');
    expect(screen.getByTestId('personal-instruction-use-template')).toBeInTheDocument();
    expect(screen.getByTestId('personal-instruction-start-blank')).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma project instruction ainda/i)).toBeInTheDocument();
  });

  it('shows Configurado chip + Edit button when the personal singleton exists', async () => {
    routeCalls({
      'instruction.list': [personal],
      'settings.get': settings(),
    });

    renderWithQuery(<InstructionsScreen />);

    await screen.findByTestId('personal-instruction-edit');
    expect(screen.getByText(/Configurado/i)).toBeInTheDocument();
  });

  it('lists project instructions with a delete + edit button per row', async () => {
    routeCalls({
      'instruction.list': [project('acme', '/repos/acme'), project('bravo', '/repos/bravo')],
      'settings.get': settings(),
    });

    renderWithQuery(<InstructionsScreen />);

    const rows = await screen.findAllByTestId('project-instruction-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('/repos/acme')).toBeInTheDocument();
    expect(screen.getByText('/repos/bravo')).toBeInTheDocument();
  });

  it('shows the Cursor sync chip on the personal card only when Cursor is enabled', async () => {
    routeCalls({
      'instruction.list': [personal],
      'settings.get': settings({ adapters: { claude: { enabled: true }, cursor: { enabled: true } } }),
    });

    renderWithQuery(<InstructionsScreen />);

    await screen.findByTestId('personal-instruction-card');
    // Claude + neutral AGENTS.md are always present; Cursor appears only when enabled.
    expect(screen.getByTestId('sync-chip-claude')).toBeInTheDocument();
    expect(screen.getByTestId('sync-chip-agents-md')).toBeInTheDocument();
    const cursorChip = screen.getByTestId('sync-chip-cursor');
    expect(cursorChip).toBeInTheDocument();
    // The exact plugin paths live in the accessible name so they stay both
    // testable and screen-reader-friendly without polluting the layout.
    expect(cursorChip).toHaveAccessibleName(/personal-default\.mdc/);
    expect(cursorChip).toHaveAccessibleName(/plugin\.json/);
  });

  it('does NOT show the Cursor sync chip when Cursor is disabled', async () => {
    routeCalls({
      'instruction.list': [personal],
      'settings.get': settings(),
    });

    renderWithQuery(<InstructionsScreen />);

    await screen.findByTestId('personal-instruction-card');
    expect(screen.queryByTestId('sync-chip-cursor')).toBeNull();
  });

  it('folder picker cancel is a no-op (no editor opened)', async () => {
    const user = userEvent.setup();
    routeCalls({
      'instruction.list': [],
      'settings.get': settings(),
      'dialog.selectFolder': { canceled: true },
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('project-instruction-add'));
    // No editor mounted after cancel.
    expect(screen.queryByTestId('customization-editor')).toBeNull();
  });

  it('folder picker success opens the editor with slugified name + repoPath from the picked path', async () => {
    const user = userEvent.setup();
    routeCalls({
      'instruction.list': [],
      'settings.get': settings(),
      'dialog.selectFolder': { canceled: false, path: '/repos/My New App' },
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('project-instruction-add'));
    const editor = await screen.findByTestId('customization-editor');
    expect(editor).toBeInTheDocument();
    // Slug is derived from the folder basename.
    expect(screen.getByText(/my-new-app/i)).toBeInTheDocument();
  });

  it('delete asks for confirmation before calling instruction.delete', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    routeCalls({
      'instruction.list': [project('acme', '/repos/acme')],
      'settings.get': settings(),
      'instruction.delete': { ok: true },
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('project-instruction-delete'));
    await waitFor(() => {
      expect(call).toHaveBeenCalledWith(
        'instruction.delete',
        expect.objectContaining({ name: 'acme', removeSymlinks: true }),
      );
    });
    confirmSpy.mockRestore();
  });

  it('delete confirm=false does NOT call instruction.delete', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    routeCalls({
      'instruction.list': [project('acme', '/repos/acme')],
      'settings.get': settings(),
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('project-instruction-delete'));
    expect(call).not.toHaveBeenCalledWith('instruction.delete', expect.anything());
    confirmSpy.mockRestore();
  });

  it('clicking "Usar template padrão" opens the editor pre-filled with template content', async () => {
    const user = userEvent.setup();
    routeCalls({
      'instruction.list': [],
      'settings.get': settings(),
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('personal-instruction-use-template'));
    expect(await screen.findByTestId('customization-editor')).toBeInTheDocument();
  });

  it('clicking Edit on an existing personal instruction opens the editor', async () => {
    const user = userEvent.setup();
    routeCalls({
      'instruction.list': [personal],
      'settings.get': settings(),
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('personal-instruction-edit'));
    expect(await screen.findByTestId('customization-editor')).toBeInTheDocument();
  });
});
