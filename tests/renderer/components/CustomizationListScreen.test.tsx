import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomizationListScreen } from '../../../src/renderer/components/CustomizationListScreen.js';
import { mockApi, ok, renderWithQuery, type CallSpy } from '../test-utils.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../src/shared/entity.js';

// Editing a workspace item opens CustomizationEditor in edit mode, which now
// renders <SessionPanel>. Lightweight mocks — same as
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

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

const skill = (name: string, source = WORKSPACE_SOURCE): Skill => ({
  urn: `urn:skill:${name}`,
  kind: 'skill',
  name,
  description: `${name} description`,
  scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source,
  content: `# ${name}\n`,
});

const workspaceSkill: Skill = { ...skill('a'), description: 'desc', content: 'workspace body' };

const pluginSkill: Skill = {
  ...skill('b', { kind: 'plugin', pluginId: 'my-plugin', provenance: 'workspace-managed' }),
  description: 'plugin desc',
  content: 'plugin body',
};

const projectScopedSkill: Skill = { ...skill('c'), scopes: ['project'], scopeId: 'proj-1' };
const workspaceScopedSkill: Skill = { ...skill('d'), scopes: ['workspace'], scopeId: 'ws-1' };
const orphanedProjectSkill: Skill = { ...skill('e'), scopes: ['project'], scopeId: 'missing-id' };

function renderScreen() {
  return renderWithQuery(
    <CustomizationListScreen
      entityType="skill"
      title="Skills"
      singular="skill"
      gender="f"
      listMethod="skill.list"
      deleteMethod="skill.delete"
    />,
  );
}

describe('<CustomizationListScreen>', () => {
  it('opens a drawer when a workspace card is clicked', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'skill.list') return Promise.resolve(ok([workspaceSkill]));
      return Promise.resolve(ok(undefined));
    });
    const user = userEvent.setup();
    renderScreen();

    const card = await screen.findByTestId('entity-grid-card-skill-workspace/urn:skill:a');
    await user.click(card);

    expect(await screen.findByTestId('detail-drawer-customization')).toBeInTheDocument();
    expect(screen.getByText('workspace body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('hides Edit button in drawer for plugin items', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'skill.list') return Promise.resolve(ok([pluginSkill]));
      return Promise.resolve(ok(undefined));
    });
    const user = userEvent.setup();
    renderScreen();

    const card = await screen.findByTestId('entity-grid-card-skill-plugin/urn:skill:b');
    await user.click(card);

    expect(await screen.findByTestId('detail-drawer-customization')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('does not show the "View" row action (replaced by row click)', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'skill.list') return Promise.resolve(ok([pluginSkill]));
      return Promise.resolve(ok(undefined));
    });
    renderScreen();
    await screen.findByTestId('entity-grid-card-skill-plugin/urn:skill:b');
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
  });

  it('closes the drawer and opens the editor when Edit is clicked inside the drawer for a workspace item', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'skill.list') return Promise.resolve(ok([workspaceSkill]));
      return Promise.resolve(ok(undefined));
    });
    const user = userEvent.setup();
    renderScreen();

    const card = await screen.findByTestId('entity-grid-card-skill-workspace/urn:skill:a');
    await user.click(card);
    const drawer = await screen.findByTestId('detail-drawer-customization');

    // Use within() to scope to the drawer (the row also has an Edit button)
    await user.click(within(drawer).getByRole('button', { name: /edit/i }));

    expect(screen.queryByTestId('detail-drawer-customization')).not.toBeInTheDocument();
    // The editor is an early-return, so the list container is gone
    expect(screen.queryByTestId('entity-list-skill')).not.toBeInTheDocument();
  });

  it('keeps a newly created item in the editor after saving, unlocking its session panel', async () => {
    call.mockImplementation((method: string, params?: unknown) => {
      if (method === 'skill.list') return Promise.resolve(ok([]));
      if (method === 'skill.save') {
        const { skill } = params as { skill: Skill };
        return Promise.resolve(ok({ skill: { ...skill, urn: 'urn:skill:new-one' }, syncReport: [] }));
      }
      return Promise.resolve(ok(undefined));
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByTestId('new-skill-button'));
    expect(screen.getByTestId('session-panel-locked')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Name'), 'new-one');
    await user.click(screen.getByRole('button', { name: /salvar/i }));

    expect(await screen.findByTestId('session-open')).toBeInTheDocument();
    expect(screen.getByTestId('customization-editor')).toBeInTheDocument();
  });

  it('shows a Personal badge for a personal-scope skill', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'skill.list') return Promise.resolve(ok([workspaceSkill]));
      return Promise.resolve(ok(undefined));
    });
    renderScreen();
    const card = await screen.findByTestId('entity-grid-card-skill-workspace/urn:skill:a');
    expect(within(card).getByText('Personal')).toBeInTheDocument();
  });

  it('shows a Workspace badge for a workspace-scope skill', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'skill.list') return Promise.resolve(ok([workspaceScopedSkill]));
      return Promise.resolve(ok(undefined));
    });
    renderScreen();
    const card = await screen.findByTestId('entity-grid-card-skill-workspace/urn:skill:d');
    expect(within(card).getByText('Workspace')).toBeInTheDocument();
  });

  it('shows the resolved Project name badge for a project-scope skill', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'skill.list') return Promise.resolve(ok([projectScopedSkill]));
      if (method === 'project.list') {
        return Promise.resolve(ok([{ id: 'proj-1', name: 'acme', path: '/repos/acme', createdAt: '' }]));
      }
      return Promise.resolve(ok(undefined));
    });
    renderScreen();
    const card = await screen.findByTestId('entity-grid-card-skill-workspace/urn:skill:c');
    expect(await within(card).findByText('acme')).toBeInTheDocument();
  });

  it('falls back to the raw scopeId badge when the referenced project is not found', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'skill.list') return Promise.resolve(ok([orphanedProjectSkill]));
      if (method === 'project.list') return Promise.resolve(ok([]));
      return Promise.resolve(ok(undefined));
    });
    renderScreen();
    const card = await screen.findByTestId('entity-grid-card-skill-workspace/urn:skill:e');
    expect(await within(card).findByText('missing-id')).toBeInTheDocument();
  });
});
