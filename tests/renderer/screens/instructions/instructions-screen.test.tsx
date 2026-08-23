import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstructionsScreen } from '../../../../src/renderer/screens/instructions/InstructionsScreen.js';
import { WORKSPACE_SOURCE, type Instruction } from '../../../../src/shared/entity.js';
import type { Settings } from '../../../../src/shared/settings.js';
import type { Project } from '../../../../src/shared/project.js';
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

const personal: Instruction = {
  urn: 'urn:instruction:default', kind: 'instruction', name: 'default',
  description: 'personal profile', scopes: ['personal'], metadata: meta,
  source: WORKSPACE_SOURCE, content: '## Section A\n- item\n',
};

// A project instruction now carries a `scopeId` pointing at a `Project` in the
// registry — no more `repoPath` on the entity itself.
const projectInstruction = (name = 'acme', scopeId = 'proj-1'): Instruction => ({
  urn: `urn:instruction:${name}`, kind: 'instruction', name, description: `${name} rules`,
  scopes: ['project'], scopeId, metadata: meta, source: WORKSPACE_SOURCE,
  content: `# ${name}\n`,
});

// A registry `Project` — what `project.list` / `project.findOrCreateByPath`
// resolve to. `ProjectInstructionRow` looks one of these up by `scopeId`.
const registryProject = (id = 'proj-1', name = 'acme', path = '/repos/acme'): Project => ({
  id, name, path, createdAt: '',
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
      'project.list': [],
    });

    renderWithQuery(<InstructionsScreen />);

    await screen.findByTestId('personal-instruction-card');
    expect(screen.getByTestId('personal-instruction-open')).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma project instruction ainda/i)).toBeInTheDocument();
  });

  it('shows Configurado chip + Edit button when the personal singleton exists', async () => {
    routeCalls({
      'instruction.list': [personal],
      'settings.get': settings(),
      'project.list': [],
    });

    renderWithQuery(<InstructionsScreen />);

    await screen.findByTestId('personal-instruction-open');
    expect(screen.getByText(/Configurado/i)).toBeInTheDocument();
  });

  it('lists project instructions with a delete + edit button per row, resolving the path via the Project registry', async () => {
    routeCalls({
      'instruction.list': [projectInstruction('acme', 'proj-1'), projectInstruction('bravo', 'proj-2')],
      'settings.get': settings(),
      'project.list': [registryProject('proj-1', 'acme', '/repos/acme'), registryProject('proj-2', 'bravo', '/repos/bravo')],
    });

    renderWithQuery(<InstructionsScreen />);

    const rows = await screen.findAllByTestId('project-instruction-row');
    expect(rows).toHaveLength(2);
    // Resolved via Project.path, not entity.repoPath (which no longer exists).
    expect(screen.getByText('/repos/acme')).toBeInTheDocument();
    expect(screen.getByText('/repos/bravo')).toBeInTheDocument();
  });

  it('shows a "Projeto não encontrado" fallback when scopeId does not resolve to a registered Project', async () => {
    routeCalls({
      'instruction.list': [projectInstruction('acme', 'stale-scope-id')],
      'settings.get': settings(),
      'project.list': [],
    });

    renderWithQuery(<InstructionsScreen />);

    await screen.findByTestId('project-instruction-row');
    expect(screen.getByText(/Projeto não encontrado/i)).toBeInTheDocument();
  });

  it('shows the Cursor sync chip on the personal card only when Cursor is enabled', async () => {
    routeCalls({
      'instruction.list': [personal],
      'settings.get': settings({ adapters: { claude: { enabled: true }, cursor: { enabled: true } } }),
      'project.list': [],
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
      'project.list': [],
    });

    renderWithQuery(<InstructionsScreen />);

    await screen.findByTestId('personal-instruction-card');
    expect(screen.queryByTestId('sync-chip-cursor')).toBeNull();
  });

  it('folder picker cancel is a no-op (no editor opened, no Project created)', async () => {
    const user = userEvent.setup();
    routeCalls({
      'instruction.list': [],
      'settings.get': settings(),
      'project.list': [],
      'dialog.selectFolder': { canceled: true },
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('project-instruction-add'));
    // No editor mounted after cancel.
    expect(screen.queryByTestId('customization-editor')).toBeNull();
    expect(call).not.toHaveBeenCalledWith('project.findOrCreateByPath', expect.anything());
  });

  it('folder picker success finds/creates a Project and opens the editor with an entity scoped to it (no repoPath)', async () => {
    const user = userEvent.setup();
    routeCalls({
      'instruction.list': [],
      'settings.get': settings(),
      'project.list': [],
      'dialog.selectFolder': { canceled: false, path: '/repos/acme' },
      'project.findOrCreateByPath': { id: 'proj-1', name: 'acme', path: '/repos/acme', createdAt: '' },
      'instruction.save': { instruction: projectInstruction('acme', 'proj-1'), syncReport: [] },
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('project-instruction-add'));

    await waitFor(() => {
      expect(call).toHaveBeenCalledWith('project.findOrCreateByPath', { path: '/repos/acme' });
    });

    const editor = await screen.findByTestId('customization-editor');
    expect(editor).toBeInTheDocument();
    // Name is slugified from the resolved Project's path.
    expect(screen.getByText(/acme/i)).toBeInTheDocument();

    // Round-trip the seeded entity through Save to inspect its actual shape —
    // scoped by `scopeId`, never `repoPath` (the pre-registry field).
    await user.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(call).toHaveBeenCalledWith(
        'instruction.save',
        expect.objectContaining({
          instruction: expect.objectContaining({ scopes: ['project'], scopeId: 'proj-1' }),
        }),
      );
    });
    const saveCall = call.mock.calls.find((args: unknown[]) => args[0] === 'instruction.save');
    const savedInstruction = (saveCall?.[1] as { instruction: Record<string, unknown> } | undefined)?.instruction;
    expect(savedInstruction).not.toHaveProperty('repoPath');
  });

  it('delete asks for confirmation with the path resolved via the Project registry, before calling instruction.delete', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    routeCalls({
      'instruction.list': [projectInstruction('acme', 'proj-1')],
      'settings.get': settings(),
      'project.list': [registryProject('proj-1', 'acme', '/repos/acme')],
      'instruction.delete': { ok: true },
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('project-instruction-delete'));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('/repos/acme'));
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
      'instruction.list': [projectInstruction('acme', 'proj-1')],
      'settings.get': settings(),
      'project.list': [registryProject('proj-1', 'acme', '/repos/acme')],
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('project-instruction-delete'));
    expect(call).not.toHaveBeenCalledWith('instruction.delete', expect.anything());
    confirmSpy.mockRestore();
  });

  it('clicking Configurar opens the editor for a new personal instruction', async () => {
    const user = userEvent.setup();
    routeCalls({
      'instruction.list': [],
      'settings.get': settings(),
      'project.list': [],
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('personal-instruction-open'));
    expect(await screen.findByTestId('customization-editor')).toBeInTheDocument();
  });

  it('clicking Edit on an existing personal instruction opens the editor', async () => {
    const user = userEvent.setup();
    routeCalls({
      'instruction.list': [personal],
      'settings.get': settings(),
      'project.list': [],
    });

    renderWithQuery(<InstructionsScreen />);

    await user.click(await screen.findByTestId('personal-instruction-open'));
    expect(await screen.findByTestId('customization-editor')).toBeInTheDocument();
  });
});
