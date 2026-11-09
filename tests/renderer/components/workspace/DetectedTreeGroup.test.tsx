import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityTreeGroup } from '../../../../src/renderer/components/workspace/EntityTreeGroup.js';
import { McpTreeGroup } from '../../../../src/renderer/components/workspace/McpTreeGroup.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { DetectedEntity } from '../../../../src/shared/detected.js';
import type { McpServer } from '../../../../src/shared/mcp.js';

const skill: DetectedEntity = {
  id: 'd-skill', kind: 'skill', name: 'review', description: 'Reviews', harness: 'cursor', scope: 'personal',
  path: '/h/.cursor/skills/review/SKILL.md', importable: true, preview: {},
};
const multiFile: DetectedEntity = { ...skill, id: 'd-big', name: 'big', importable: false, reason: 'The skill has extra files' };

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
});

describe('detected skills inside the kind group', () => {
  it('shows nothing extra when nothing was detected', async () => {
    call.mockImplementation(async () => ok([]));
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" onEdit={() => {}} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('detected.list', { kinds: ['skill'] }));
    expect(screen.queryByTestId('tree-detected-d-skill')).not.toBeInTheDocument();
  });

  it('lists detected items in the Skills group and imports one from the row menu', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'detected.list') return ok([skill, multiFile]);
      if (method === 'skill.list') return ok([]);
      return ok({});
    });
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" onEdit={() => {}} />);
    await user.click(await screen.findByTestId('tree-group-skill'));
    expect(await screen.findByTestId('tree-detected-d-skill')).toHaveTextContent('detectado · Cursor');
    expect(screen.getByTestId('tree-detected-d-big')).toHaveTextContent('não importável');
    // Hover reveals nothing: the menu is the context menu, and a row that cannot be imported has none.
    fireEvent.contextMenu(screen.getByTestId('tree-detected-d-big'));
    expect(screen.queryByText('Importar')).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId('tree-detected-d-skill'));
    await user.click(await screen.findByText('Importar'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('detected.import', { id: 'd-skill' }));
  });

  it('keeps a folder\'s detected items out of other folders', async () => {
    const user = userEvent.setup();
    const inA: DetectedEntity = { ...skill, id: 'd-a', name: 'in-a', scope: 'workspace', folder: '/w/a' };
    call.mockImplementation(async (method: string) => (method === 'detected.list' ? ok([inA]) : method === 'skill.list' ? ok([]) : ok({})));
    const scope = (folder: string) => ({ scope: 'workspace' as const, scopeId: 'ws', folder });
    const { unmount } = renderWithShell(<EntityTreeGroup kind="skill" label="Skills" localScope={scope('/w/b')} onEdit={() => {}} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('detected.list', { kinds: ['skill'] }));
    expect(screen.queryByTestId('tree-detected-d-a')).not.toBeInTheDocument();
    unmount();
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" localScope={scope('/w/a')} onEdit={() => {}} />);
    await user.click(await screen.findByTestId('tree-group-skill'));
    expect(await screen.findByTestId('tree-detected-d-a')).toBeInTheDocument();
  });
});

describe('McpTreeGroup detected rows', () => {
  it('offers Importar on an importable detected server and not on a read-only one', async () => {
    const user = userEvent.setup();
    const detected = (id: string, importable: boolean): McpServer => ({
      id, name: id, def: {}, scope: 'detected', enabled: true,
      source: { kind: 'detected', detectedId: `det-${id}`, harness: 'cursor', importable },
    });
    call.mockImplementation(async (method: string) =>
      method === 'mcp.list' ? ok([detected('fs', true), detected('bad', false)]) : ok({}));
    renderWithShell(<McpTreeGroup showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-mcp'));
    expect(await screen.findByTestId('tree-mcp-harness-fs')).toHaveTextContent('Cursor');
    fireEvent.contextMenu(screen.getByTestId('tree-mcp-bad'));
    expect(screen.queryByText('Importar')).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId('tree-mcp-fs'));
    await user.click(await screen.findByText('Importar'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('detected.import', { id: 'det-fs' }));
  });
});
