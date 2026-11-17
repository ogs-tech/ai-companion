import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RowBadgeSlot } from '../../../../src/renderer/components/workspace/RowBadgeSlot.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { treeItem } from './tree-item-fixture.js';
import type { Skill } from '../../../../src/shared/entity.js';

const skill = { urn: 'urn:skill:backlog', kind: 'skill', name: 'backlog' } as unknown as Skill;
const notInstalledInCursor = treeItem(
  { kind: 'skill', value: skill },
  {
    urn: skill.urn,
    name: 'backlog',
    status: {
      status: 'draft',
      reason: 'not-installed',
      channels: { claude: { status: 'installed' }, cursor: { status: 'draft', reason: 'not-installed' } },
    },
  },
);

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => ok(method === 'adapter.install' ? { undoToken: 'install-1' } : undefined));
});

describe('RowBadgeSlot — not installed', () => {
  it('installs over the unmanaged file in that channel only, and Desfazer puts it back', async () => {
    const user = userEvent.setup();
    renderWithShell(<RowBadgeSlot item={notInstalledInCursor} />);
    const tag = screen.getByTestId('row-tag-not-installed');
    expect(tag).toHaveTextContent('Instalar');

    await user.click(tag);
    await waitFor(() => expect(call).toHaveBeenCalledWith('adapter.install', { urn: 'urn:skill:backlog', adapterId: 'cursor' }));
    expect(call).not.toHaveBeenCalledWith('adapter.install', expect.objectContaining({ adapterId: 'claude' }));
    expect(await screen.findByText('"backlog" instalado no Cursor')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('adapter.undoInstall', { undoToken: 'install-1' }));
  });
});
