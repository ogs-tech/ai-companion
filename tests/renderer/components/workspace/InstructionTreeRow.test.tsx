import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { InstructionTreeRow, ProjectInstructionRow } from '../../../../src/renderer/components/workspace/InstructionTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { Instruction } from '../../../../src/shared/entity.js';
import type { Project } from '../../../../src/shared/project.js';

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
  it('labels the personal row plainly "INSTRUCTIONS"', () => {
    renderWithShell(
      <InstructionTreeRow kind="personal" instruction={null} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId('personal-instruction-row')).toHaveTextContent('INSTRUCTIONS');
  });

  it('labels the workspace row plainly "INSTRUCTIONS"', () => {
    renderWithShell(
      <InstructionTreeRow kind="workspace" instruction={null} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId('workspace-instruction-row')).toHaveTextContent('INSTRUCTIONS');
  });

  it('labels a project row plainly "INSTRUCTIONS" too — depth-based indentation, not a name prefix, conveys which project it belongs to', () => {
    renderWithShell(
      <InstructionTreeRow kind="project" instruction={null} seed={() => instruction()} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId('project-instruction-row')).toHaveTextContent('INSTRUCTIONS');
  });

  it('overrides the default data-testid when a testId is supplied', () => {
    renderWithShell(
      <InstructionTreeRow
        kind="project"
        instruction={null}
        seed={() => instruction()}
        onOpen={vi.fn()}
        testId="tree-node-instructions-apps"
      />,
    );
    expect(screen.getByTestId('tree-node-instructions-apps')).toBeInTheDocument();
    expect(screen.queryByTestId('project-instruction-row')).not.toBeInTheDocument();
  });
});

describe('ProjectInstructionRow', () => {
  const project: Project = { id: 'p1', name: 'apps', path: '/repos/monorepo/apps', createdAt: '' };

  it('fetches that Project\'s own instruction and labels it plainly "INSTRUCTIONS"', async () => {
    const projectInstruction = instruction({
      urn: 'urn:instruction:apps', name: 'apps', scopes: ['project'], scopeId: 'p1',
    });
    call.mockImplementation(async (method: string) =>
      method === 'instruction.list' ? ok([projectInstruction]) : ok(undefined),
    );
    renderWithShell(<ProjectInstructionRow project={project} onOpen={vi.fn()} />);
    const row = await screen.findByTestId('project-instruction-row');
    expect(row).toHaveTextContent('INSTRUCTIONS');
  });

  it('renders with a custom testId, for when several Project rows are mounted at once', async () => {
    renderWithShell(
      <ProjectInstructionRow project={project} onOpen={vi.fn()} testId="tree-node-instructions-apps" />,
    );
    expect(await screen.findByTestId('tree-node-instructions-apps')).toBeInTheDocument();
  });

  it('opens the seeded (unsaved) instruction when clicked and none exists yet', async () => {
    const onOpen = vi.fn();
    renderWithShell(<ProjectInstructionRow project={project} onOpen={onOpen} />);
    const row = await screen.findByTestId('project-instruction-row');
    row.click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['project'], scopeId: 'p1' }), true);
  });
});
