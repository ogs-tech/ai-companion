import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { InstructionTreeRow } from '../../../../src/renderer/components/workspace/InstructionTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { Instruction } from '../../../../src/shared/entity.js';
import type { DetectedEntity } from '../../../../src/shared/detected.js';

function instruction(overrides: Partial<Instruction> = {}): Instruction {
  return {
    urn: 'urn:instruction:default',
    kind: 'instruction',
    name: 'default',
    description: '',
    scopes: ['personal'],
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: { kind: 'workspace' },
    content: '',
    ...overrides,
  };
}

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async () => ok(undefined));
});

describe('InstructionTreeRow session badge', () => {
  it('shows a running-session badge when this instruction has an active session', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'session.list'
        ? ok([
            {
              sessionId: 'entity:urn:instruction:default',
              anchor: { kind: 'entity', urn: 'urn:instruction:default' },
              cwd: '/x',
              label: 'default',
              status: 'running',
            },
          ])
        : ok(undefined),
    );
    renderWithShell(
      <InstructionTreeRow kind="personal" instruction={instruction()} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    expect(await screen.findByText('Ocioso')).toBeInTheDocument();
  });

  it('shows no badge when the instruction has never had a session', async () => {
    renderWithShell(
      <InstructionTreeRow kind="personal" instruction={instruction()} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    await screen.findByTestId('personal-instruction-row');
    expect(screen.queryByText('Ocioso')).not.toBeInTheDocument();
  });

  it('shows no badge when there is no instruction yet (not saved)', () => {
    renderWithShell(
      <InstructionTreeRow kind="personal" instruction={null} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    expect(screen.queryByText('Ocioso')).not.toBeInTheDocument();
  });
});

describe('InstructionTreeRow labels', () => {
  it('labels the personal row plainly "Instructions"', () => {
    renderWithShell(
      <InstructionTreeRow kind="personal" instruction={null} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId('personal-instruction-row')).toHaveTextContent('Instructions');
  });

  it('labels the workspace row plainly "Instructions"', () => {
    renderWithShell(
      <InstructionTreeRow kind="workspace" instruction={null} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId('workspace-instruction-row')).toHaveTextContent('Instructions');
  });

  it('overrides the default data-testid when a testId is supplied', () => {
    renderWithShell(
      <InstructionTreeRow
        kind="workspace"
        instruction={null}
        seed={() => instruction()}
        onOpen={vi.fn()}
        testId="tree-node-instructions-apps"
      />,
    );
    expect(screen.getByTestId('tree-node-instructions-apps')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-instruction-row')).not.toBeInTheDocument();
  });
});

describe('InstructionTreeRow context menu — New Action', () => {
  it('offers "New Action" for a configured personal instruction (unlike "Properties", it is not excluded there)', async () => {
    const onNewAction = vi.fn();
    const target = instruction();
    renderWithShell(
      <InstructionTreeRow kind="personal" instruction={target} seed={() => target} onOpen={vi.fn()} onNewAction={onNewAction} />,
    );
    const row = await screen.findByTestId('personal-instruction-row');
    fireEvent.contextMenu(row);
    const item = await screen.findByTestId('row-context-menu-new-action');
    fireEvent.click(item);
    expect(onNewAction).toHaveBeenCalledWith(target);
  });

  it('offers "New Action" for a configured workspace instruction', async () => {
    const onNewAction = vi.fn();
    const target = instruction({ urn: 'urn:instruction:acme', name: 'acme', scopes: ['workspace'], scopeId: 'w1' });
    renderWithShell(
      <InstructionTreeRow kind="workspace" instruction={target} seed={() => target} onOpen={vi.fn()} onNewAction={onNewAction} />,
    );
    const row = await screen.findByTestId('workspace-instruction-row');
    fireEvent.contextMenu(row);
    const item = await screen.findByTestId('row-context-menu-new-action');
    fireEvent.click(item);
    expect(onNewAction).toHaveBeenCalledWith(target);
  });

  it('offers no context menu at all while the instruction is not yet configured', () => {
    const onNewAction = vi.fn();
    renderWithShell(
      <InstructionTreeRow kind="personal" instruction={null} seed={() => instruction()} onOpen={vi.fn()} onNewAction={onNewAction} />,
    );
    const row = screen.getByTestId('personal-instruction-row');
    fireEvent.contextMenu(row);
    expect(screen.queryByTestId('row-context-menu-new-action')).not.toBeInTheDocument();
  });
});


const detectedFile: DetectedEntity = {
  id: 'det-1', kind: 'instruction', name: 'default', description: 'AGENTS.md', harness: 'claude',
  scope: 'personal', path: '/home/u/AGENTS.md', importable: true, preview: { file: 'AGENTS.md' },
};

describe('InstructionTreeRow status', () => {
  it('shows nothing but the dimmed name when there is neither an instruction nor a detected file', () => {
    renderWithShell(<InstructionTreeRow kind="folder" instruction={null} seed={() => instruction()} onOpen={vi.fn()} />);
    expect(screen.queryByTestId('sync-dot')).not.toBeInTheDocument();
    expect(screen.queryByTestId('detected-apply')).not.toBeInTheDocument();
  });

  it('offers the detected file: its name, a single "Aplicar", and the detected dot', () => {
    renderWithShell(<InstructionTreeRow kind="personal" instruction={null} detected={detectedFile} seed={() => instruction()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('detected-file')).toHaveTextContent('AGENTS.md');
    expect(screen.getByTestId('detected-apply')).toHaveTextContent('Aplicar');
    expect(screen.getByTestId('sync-dot')).toHaveAttribute('data-state', 'detected');
  });

  it('Aplicar imports the file and opens the imported instruction for editing, without starting an empty one', async () => {
    const imported = instruction({ content: 'from file' });
    call.mockImplementation(async (method: string) => (method === 'detected.import' ? ok({ entity: imported, syncReport: [] }) : ok(undefined)));
    const onOpen = vi.fn();
    renderWithShell(<InstructionTreeRow kind="personal" instruction={null} detected={detectedFile} seed={() => instruction()} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('detected-apply'));
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(call).toHaveBeenCalledWith('detected.import', { id: 'det-1' });
    expect(onOpen).toHaveBeenCalledWith(imported, false);
  });

  it('clicking the row itself while a file is detected starts an empty instruction ("Criar do zero")', () => {
    const onOpen = vi.fn();
    const seed = instruction({ content: 'seed' });
    renderWithShell(<InstructionTreeRow kind="personal" instruction={null} detected={detectedFile} seed={() => seed} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('personal-instruction-row'));
    expect(onOpen).toHaveBeenCalledWith(seed, true);
  });

  it('stays silent when the instruction is healthy in every channel', async () => {
    call.mockImplementation(async (method: string) => (method === 'health.getReport' ? ok({ checks: [] }) : ok(undefined)));
    renderWithShell(<InstructionTreeRow kind="personal" instruction={instruction()} seed={() => instruction()} onOpen={vi.fn()} />);
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('health.getReport', expect.anything()));
    expect(screen.queryByTestId('channel-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sync-dot')).not.toBeInTheDocument();
  });

  it('flags only the channel that fails, with a warning and its name', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'health.getReport'
        ? ok({ checks: [
            { id: 'a', category: 'symlink', severity: 'ok', title: 't', entityUrn: 'urn:instruction:default', channel: 'claude', observedAt: '' },
            { id: 'b', category: 'generated-file', severity: 'error', title: 't', entityUrn: 'urn:instruction:default', channel: 'cursor', observedAt: '' },
          ] })
        : ok(undefined),
    );
    renderWithShell(<InstructionTreeRow kind="personal" instruction={instruction()} seed={() => instruction()} onOpen={vi.fn()} />);
    expect(await screen.findByTestId('channel-warning')).toHaveTextContent('⚠ Cursor');
  });
});
