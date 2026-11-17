import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
  it('reads "detectado · importar" with its harness, and imports from the row menu', async () => {
    const item = itemOf(detected());
    renderWithShell(<DetectedTreeRow item={item} />);
    const row = screen.getByTestId(rowId(item));
    expect(row).toHaveTextContent('detectado · importar');
    expect(row).toHaveTextContent('Claude');
    fireEvent.contextMenu(row);
    await userEvent.setup().click(await screen.findByTestId('row-context-menu-import'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('detected.import', { id: 'd-skill' }));
  });

  it('a non-importable item has no menu and says so', () => {
    const item = itemOf(detected({ importable: false, reason: 'symlink' }));
    renderWithShell(<DetectedTreeRow item={item} />);
    const row = screen.getByTestId(rowId(item));
    expect(row).toHaveTextContent('detectado · não importável');
    fireEvent.contextMenu(row);
    expect(screen.queryByTestId('row-context-menu-import')).not.toBeInTheDocument();
  });
});
