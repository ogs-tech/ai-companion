import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { InstructionTreeRow } from '../../../../src/renderer/components/workspace/InstructionTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { Instruction } from '../../../../src/shared/entity.js';

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
    expect(await screen.findByText('Ativa')).toBeInTheDocument();
  });

  it('shows no badge when the instruction has never had a session', async () => {
    renderWithShell(
      <InstructionTreeRow kind="personal" instruction={instruction()} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    await screen.findByTestId('personal-instruction-row');
    expect(screen.queryByText('Ativa')).not.toBeInTheDocument();
  });

  it('shows no badge when there is no instruction yet (not saved)', () => {
    renderWithShell(
      <InstructionTreeRow kind="personal" instruction={null} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    expect(screen.queryByText('Ativa')).not.toBeInTheDocument();
  });
});

describe('InstructionTreeRow labels', () => {
  it('labels the personal row plainly "instructions"', () => {
    renderWithShell(
      <InstructionTreeRow kind="personal" instruction={null} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId('personal-instruction-row')).toHaveTextContent('instructions');
  });

  it('labels the workspace row plainly "instructions"', () => {
    renderWithShell(
      <InstructionTreeRow kind="workspace" instruction={null} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId('workspace-instruction-row')).toHaveTextContent('instructions');
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

