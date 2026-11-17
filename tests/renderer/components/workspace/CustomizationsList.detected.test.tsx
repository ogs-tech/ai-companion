import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { CustomizationsList, type CustomizationsListProps } from '../../../../src/renderer/components/workspace/CustomizationsList.js';
import userEvent from '@testing-library/user-event';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { DetectedEntity } from '../../../../src/shared/detected.js';
import { seedFolderInstruction } from '../../../../src/renderer/lib/instruction-seed.js';

const workspace = { id: 'w1', name: 'Alephee', rootPath: '/r/core', extraFolders: ['/r/ui', '/r/bees'], createdAt: '' };
const metadata = { version: '0.1.0', createdAt: '', updatedAt: '' };
const detected = (id: string, folder: string, harness: 'claude' | 'cursor' = 'cursor'): DetectedEntity => ({
  id, kind: 'skill', name: id, description: '', harness, scope: 'workspace', folder, path: `${folder}/.cursor/skills/${id}/SKILL.md`, importable: true, preview: {},
});
const row = (origin: string, identity: string, alias = ''): string => `tree-row-${origin}:${alias}:${identity}`;

let call: CallSpy;
beforeEach(() => {
  window.localStorage.clear();
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'workspace.getActive') return ok(workspace);
    if (method === 'detected.list') return ok([detected('backlog', '/r/bees'), detected('planner', '/r/ui'), detected('smoke', '/r/ui', 'claude')]);
    return ok([]);
  });
});

const props = (): CustomizationsListProps => ({
  isHome: false,
  localScope: { scope: 'workspace', scopeId: 'w1' },
  onEditEntity: vi.fn(), onPreviewEntity: vi.fn(), onEntityProperties: vi.fn(), onNewActionForEntity: vi.fn(),
  onOpenInstruction: vi.fn(), onInstructionProperties: vi.fn(), onNewActionForInstruction: vi.fn(), onOpenInherited: vi.fn(),
  seedWorkspaceInstruction: () => ({ urn: '', kind: 'instruction', enabled: true, name: 'core', description: '', scopes: ['workspace'], scopeId: 'w1', metadata, source: { kind: 'workspace' }, content: '' }),
  seedFolderInstruction: (folder, taken) => seedFolderInstruction(workspace, folder, taken),
});

describe('CustomizationsList detected items and folders', () => {
  it('lists detected skills in Skills after the scope’s own, tagged with their folder, importable from the tag', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'workspace.getActive') return ok(workspace);
      if (method === 'detected.list') return ok([detected('backlog', '/r/bees'), detected('planner', '/r/ui')]);
      if (method === 'skill.list') return ok([{ urn: 'urn:skill:zeta', kind: 'skill', name: 'zeta', description: '', scopes: ['workspace'], scopeId: 'w1', metadata, source: { kind: 'workspace' }, content: '' }]);
      if (method === 'detected.import') return ok({ params });
      return ok([]);
    });
    renderWithShell(<CustomizationsList {...props()} />);
    const backlog = await screen.findByTestId(row('detected', 'detected:backlog', 'bees'));
    const own = screen.getByTestId(row('local', 'urn:skill:zeta'));
    expect((own.compareDocumentPosition(backlog) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect(within(backlog).getByTestId('row-folder')).toHaveTextContent('bees');
    expect(screen.getByTestId(row('detected', 'detected:planner', 'ui'))).toHaveTextContent('Cursor');
    expect(screen.getByTestId('chip-draft')).toHaveTextContent('Draft 2');

    await user.click(within(backlog).getByTestId('row-tag-detected'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('detected.import', { id: 'backlog' }));
  });

  it('keeps one row per harness for the same detected name', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return ok(workspace);
      if (method === 'detected.list') return ok([detected('smoke', '/r/ui', 'claude'), { ...detected('smoke', '/r/ui', 'cursor'), id: 'smoke-cursor' }]);
      return ok([]);
    });
    renderWithShell(<CustomizationsList {...props()} />);
    expect(await screen.findByTestId(row('detected', 'detected:smoke', 'ui'))).toHaveTextContent('Claude');
    expect(screen.getByTestId(row('detected', 'detected:smoke-cursor', 'ui'))).toHaveTextContent('Cursor');
  });

  it('gives every folder its own Instructions row at the top of Workspace: hollow, or offering the file found there', async () => {
    const instructionFile: DetectedEntity = {
      id: 'ins-ui', kind: 'instruction', name: 'ui', description: 'AGENTS.md', harness: 'claude', scope: 'workspace', folder: '/r/ui',
      path: '/r/ui/AGENTS.md', importable: true, preview: { file: 'AGENTS.md' },
    };
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return ok(workspace);
      if (method === 'detected.list') return ok([instructionFile]);
      if (method === 'instruction.get') return ok(null);
      return ok([]);
    });
    const p = props();
    renderWithShell(<CustomizationsList {...p} />);

    const ui = await screen.findByTestId('folder-instruction-row-ui');
    expect(ui).toHaveTextContent('AGENTS.md');
    expect(ui).toHaveTextContent('Importar');
    expect(within(ui).getByTestId('row-folder')).toHaveTextContent('ui');
    const workspaceRow = screen.getByTestId('workspace-instruction-row');
    expect((workspaceRow.compareDocumentPosition(ui) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect(ui).toHaveTextContent('Instructions · ui');
    // Placeholders are places to create, not items.
    expect(screen.getByTestId('control-panel-section-local')).toHaveTextContent('0');

    // "Criar do zero": the click seeds an empty instruction owned by that folder.
    await userEvent.setup().click(screen.getByTestId('folder-instruction-row-bees'));
    expect(p.onOpenInstruction).toHaveBeenCalledWith(expect.objectContaining({ name: 'bees', folder: '/r/bees', scopes: ['workspace'], scopeId: 'w1' }), true);
  });
});
