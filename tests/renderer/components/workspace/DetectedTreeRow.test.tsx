import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetectedTreeRow } from '../../../../src/renderer/components/workspace/DetectedTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { rowId, treeItem } from './tree-item-fixture.js';
import type { DetectedEntity } from '../../../../src/shared/detected.js';

const detected = (over: Partial<DetectedEntity> = {}): DetectedEntity => ({
  id: 'd-skill', kind: 'skill', name: 'big', description: '', harness: 'claude', scope: 'personal', path: '/h/.claude/skills/big/SKILL.md', importable: true, preview: {}, ...over,
});
const itemOf = (d: DetectedEntity) => treeItem({ kind: 'detected', value: d }, { urn: `urn:skill:${d.name}`, name: d.name, origin: 'detected', identity: `detected:${d.id}` });

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async () => ok(undefined));
});

describe('DetectedTreeRow', () => {
  it('recedes in place with no tag, and imports from the first item of its menu', async () => {
    const item = itemOf(detected());
    renderWithShell(<DetectedTreeRow item={item} />);
    const row = screen.getByTestId(rowId(item));
    expect(row).toHaveTextContent(/^big$/);
    fireEvent.contextMenu(row);
    const [first] = within(await screen.findByRole('menu')).getAllByRole('menuitem');
    expect(first).toHaveAttribute('data-testid', 'row-context-menu-import');
    await userEvent.setup().click(first!);
    await waitFor(() => expect(call).toHaveBeenCalledWith('detected.import', { id: 'd-skill' }));
  });

  it('a non-importable item has no menu and says why', () => {
    const item = itemOf(detected({ importable: false, reason: 'symlink' }));
    renderWithShell(<DetectedTreeRow item={item} />);
    const row = screen.getByTestId(rowId(item));
    expect(screen.getByTestId('row-tag-unimportable')).toHaveTextContent('symlink');
    fireEvent.contextMenu(row);
    expect(screen.queryByTestId('row-context-menu-import')).not.toBeInTheDocument();
  });
});
