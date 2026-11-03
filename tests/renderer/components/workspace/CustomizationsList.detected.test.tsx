import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { CustomizationsList, type CustomizationsListProps } from '../../../../src/renderer/components/workspace/CustomizationsList.js';
import userEvent from '@testing-library/user-event';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { DetectedEntity } from '../../../../src/shared/detected.js';

const workspace = { id: 'w1', name: 'Alephee', rootPath: '/r/core', extraFolders: ['/r/ui', '/r/bees'], createdAt: '' };
const detected = (id: string, folder: string, harness: 'claude' | 'cursor' = 'cursor'): DetectedEntity => ({
  id, kind: 'skill', name: id, description: '', harness, scope: 'workspace', folder, path: `${folder}/.cursor/skills/${id}/SKILL.md`, importable: true, preview: {},
});

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
});

describe('CustomizationsList detected items', () => {
  it("lists each folder's detected skills inside that folder's own group", async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...props()} />);
    const bees = await screen.findByTestId('tree-subgroup-origin-folder-bees');
    const ui = screen.getByTestId('tree-subgroup-origin-folder-ui');
    // Nothing leaks outside the folder groups, even before they are expanded.
    expect(screen.queryByTestId('tree-detected-backlog')).not.toBeInTheDocument();

    await waitFor(() => expect(bees).toHaveTextContent('1'));
    expect(ui).toHaveTextContent('2');
    for (const group of screen.getAllByTestId('tree-group-skill')) await user.click(group);
    expect(await screen.findAllByTestId('tree-detected-backlog')).toHaveLength(1);
    expect(screen.getAllByTestId('tree-detected-planner')).toHaveLength(1);
    expect(screen.getAllByTestId('tree-detected-smoke')).toHaveLength(1);
    // DOM order follows the workspace's folders: ui header, its row, then bees header, its rows.
    const follows = (a: Element, b: Element): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const backlog = screen.getByTestId('tree-detected-backlog');
    const planner = screen.getByTestId('tree-detected-planner');
    expect(follows(ui, planner) && follows(planner, bees) && follows(bees, backlog)).toBe(true);
  });
});
