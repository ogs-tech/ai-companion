import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomizationEditor } from '../../../src/renderer/components/CustomizationEditor.js';
import { mockApi, ok, fail, renderWithQuery, type CallSpy } from '../test-utils.js';
import { WORKSPACE_SOURCE, type Instruction, type Skill } from '../../../src/shared/entity.js';
import type { Project } from '../../../src/shared/project.js';
import type { Workspace } from '../../../src/shared/workspace.js';

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

const baseCustomization = (): Skill => ({
  urn: 'urn:skill:foo',
  kind: 'skill',
  name: 'foo',
  description: 'sample',
  scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE,
  content: '# Title\n\nSome **markdown** body.',
});

const basePersonalInstruction = (): Instruction => ({
  urn: 'urn:instruction:default',
  kind: 'instruction',
  name: 'default',
  description: 'ignored on save (frontmatter-free storage)',
  scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE,
  content: '# Personal profile\n',
});

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

describe('<CustomizationEditor>', () => {
  it('renders a textarea for the body', () => {
    renderWithQuery(
      <CustomizationEditor
        initial={baseCustomization()}
        isCreate={true}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('body-textarea')).toBeInTheDocument();
  });

  it('renders the markdown preview via react-markdown', () => {
    renderWithQuery(
      <CustomizationEditor
        initial={baseCustomization()}
        isCreate={true}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const preview = screen.getByTestId('markdown-preview');
    expect(preview.querySelector('h1')?.textContent).toBe('Title');
    expect(preview.querySelector('strong')?.textContent).toBe('markdown');
  });

  it('clicking Save dispatches skill.save (workspace flow) and shows success toast on ok envelope', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const initial = baseCustomization();
    call.mockResolvedValue(
      ok({
        skill: { ...initial },
        syncReport: [],
      }),
    );

    renderWithQuery(
      <CustomizationEditor
        initial={initial}
        isCreate={true}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        'skill.save',
        expect.objectContaining({ isCreate: true }),
      ),
    );

    expect(await screen.findByTestId('toast')).toHaveAttribute('data-variant', 'success');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('renders the skill/agent scope toggle with Personal selected by default', () => {
    const initial = baseCustomization();
    initial.scopes = ['personal'];
    renderWithQuery(
      <CustomizationEditor
        initial={initial}
        isCreate={false}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Personal', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project' })).toBeInTheDocument();
    // Old multi-select checkbox UI is gone for skill/agent.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('clicking Workspace scopes the skill to the active workspace and saves scopeId', async () => {
    const user = userEvent.setup();
    const initial = baseCustomization();
    const activeWorkspace: Workspace = { id: 'ws-1', name: 'W', rootPath: '/repos/ws', isDefault: true, createdAt: '' };
    call.mockImplementation((method: string) => {
      if (method === 'workspace.getActive') return Promise.resolve(ok(activeWorkspace));
      if (method === 'project.list') return Promise.resolve(ok([]));
      if (method === 'skill.save') {
        return Promise.resolve(ok({ skill: { ...initial, scopes: ['workspace'], scopeId: 'ws-1' }, syncReport: [] }));
      }
      return Promise.resolve(ok(undefined));
    });

    renderWithQuery(
      <CustomizationEditor
        initial={initial}
        isCreate={true}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Workspace' }));
    expect(screen.getByRole('button', { name: 'Workspace', pressed: true })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        'skill.save',
        expect.objectContaining({
          skill: expect.objectContaining({ scopes: ['workspace'], scopeId: 'ws-1' }),
        }),
      ),
    );
  });

  it('editing the name in edit mode still sends the original urn (so the service detects a rename)', async () => {
    const user = userEvent.setup();
    const initial = baseCustomization(); // urn 'urn:skill:foo', name 'foo'
    call.mockResolvedValue(ok({ skill: { ...initial, name: 'bar' }, syncReport: [] }));

    renderWithQuery(
      <CustomizationEditor
        initial={initial}
        isCreate={false}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const nameField = screen.getByLabelText('Name');
    await user.clear(nameField);
    await user.type(nameField, 'bar');
    await user.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        'skill.save',
        expect.objectContaining({
          skill: expect.objectContaining({ urn: 'urn:skill:foo', name: 'bar' }),
        }),
      ),
    );
  });

  it('clicking Project reveals a picker populated from useProjects(), and picking one saves its id as scopeId', async () => {
    const user = userEvent.setup();
    const initial = baseCustomization();
    const projects: Project[] = [
      { id: 'proj-1', name: 'acme', path: '/repos/acme', createdAt: '' },
      { id: 'proj-2', name: 'beta', path: '/repos/beta', createdAt: '' },
    ];
    call.mockImplementation((method: string) => {
      if (method === 'project.list') return Promise.resolve(ok(projects));
      if (method === 'skill.save') {
        return Promise.resolve(ok({ skill: { ...initial, scopes: ['project'], scopeId: 'proj-2' }, syncReport: [] }));
      }
      return Promise.resolve(ok(undefined));
    });

    renderWithQuery(
      <CustomizationEditor
        initial={initial}
        isCreate={true}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Project' }));
    await user.click(await screen.findByRole('combobox', { name: 'Project' }));
    await user.click(await screen.findByRole('option', { name: 'beta' }));

    await user.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        'skill.save',
        expect.objectContaining({
          skill: expect.objectContaining({ scopes: ['project'], scopeId: 'proj-2' }),
        }),
      ),
    );
  });

  it('"+ Novo project…" opens the folder dialog, finds-or-creates the Project, and selects it', async () => {
    const user = userEvent.setup();
    const initial = baseCustomization();
    const newProject: Project = { id: 'proj-new', name: 'gamma', path: '/repos/gamma', createdAt: '' };
    call.mockImplementation((method: string) => {
      if (method === 'project.list') return Promise.resolve(ok([]));
      if (method === 'dialog.selectFolder') return Promise.resolve(ok({ canceled: false, path: '/repos/gamma' }));
      if (method === 'project.findOrCreateByPath') return Promise.resolve(ok(newProject));
      if (method === 'skill.save') {
        return Promise.resolve(ok({ skill: { ...initial, scopes: ['project'], scopeId: 'proj-new' }, syncReport: [] }));
      }
      return Promise.resolve(ok(undefined));
    });

    renderWithQuery(
      <CustomizationEditor
        initial={initial}
        isCreate={true}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Project' }));
    await user.click(await screen.findByRole('combobox', { name: 'Project' }));
    await user.click(await screen.findByRole('option', { name: '+ Novo project…' }));

    await waitFor(() => expect(call).toHaveBeenCalledWith('dialog.selectFolder', {}));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('project.findOrCreateByPath', { path: '/repos/gamma' }),
    );

    await user.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        'skill.save',
        expect.objectContaining({
          skill: expect.objectContaining({ scopes: ['project'], scopeId: 'proj-new' }),
        }),
      ),
    );
  });

  it('renders the instruction branch\'s Checkbox/FormGroup scope UI, not the ToggleButtonGroup, when scope is visible', () => {
    renderWithQuery(
      <CustomizationEditor
        initial={basePersonalInstruction()}
        isCreate={false}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /personal/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /project/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Workspace' })).toBeNull();
  });

  // Personal instruction: name/scope are fixed AND description/version aren't
  // persisted (frontmatter-free storage). Hiding all four fields must fully
  // suppress the Frontmatter panel — otherwise the user sees empty widgets that
  // do nothing on save.
  it('hides the entire Frontmatter section when all frontmatter fields are hidden', () => {
    renderWithQuery(
      <CustomizationEditor
        initial={basePersonalInstruction()}
        isCreate={false}
        hiddenFields={new Set(['name', 'scope', 'description', 'version'])}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Description')).toBeNull();
    expect(screen.queryByLabelText('Version')).toBeNull();
    expect(screen.queryByLabelText('Name')).toBeNull();
    // No scope checkboxes either.
    expect(screen.queryByRole('checkbox', { name: /personal/i })).toBeNull();
    // Body panel must still be there.
    expect(screen.getByTestId('body-textarea')).toBeInTheDocument();
  });

  it('shows error toast with the validation message when save fails', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(fail('validation', 'slug inválido'));

    renderWithQuery(
      <CustomizationEditor
        initial={baseCustomization()}
        isCreate={true}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /salvar/i }));

    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveAttribute('data-variant', 'error');
    expect(toast).toHaveTextContent(/slug inválido/);
  });

  describe('"Gerar com IA" (enableGenerate)', () => {
    it('is not shown when enableGenerate is not set', () => {
      renderWithQuery(
        <CustomizationEditor
          initial={baseCustomization()}
          isCreate={true}
          onSaved={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('editor-generate-open')).toBeNull();
    });

    it('reveals a context field + submit button when opened', async () => {
      const user = userEvent.setup();
      renderWithQuery(
        <CustomizationEditor
          initial={basePersonalInstruction()}
          isCreate={false}
          enableGenerate
          onSaved={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      await user.click(screen.getByTestId('editor-generate-open'));
      expect(screen.getByTestId('editor-generate-context')).toBeInTheDocument();
      expect(screen.getByTestId('editor-generate-submit')).toBeInTheDocument();
    });

    it('streams live text deltas into the body field and shows the phase pill while generating', async () => {
      const user = userEvent.setup();
      let resolveCall: (value: unknown) => void = () => {};
      call.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

      renderWithQuery(
        <CustomizationEditor
          initial={basePersonalInstruction()}
          isCreate={false}
          enableGenerate
          onSaved={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      await user.click(screen.getByTestId('editor-generate-open'));
      await user.click(screen.getByTestId('editor-generate-submit'));

      const onProgress = vi.mocked(window.api.onInstructionGenerateProgress);
      const listener = onProgress.mock.calls[0]?.[0];
      expect(listener).toBeTypeOf('function');

      listener?.({ phase: 'writing', textDelta: 'Hello ' });
      listener?.({ phase: 'writing', textDelta: 'world' });

      await waitFor(() => expect(screen.getByTestId('body-textarea')).toHaveValue('Hello world'));
      expect(screen.getByTestId('editor-generate-phase')).toHaveTextContent(/escrevendo/i);
      expect(screen.getByTestId('body-textarea')).toBeDisabled();
      expect(screen.getByRole('button', { name: /salvar/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /cancelar/i })).toBeDisabled();

      resolveCall(ok({ content: 'Hello world' }));
      await waitFor(() => expect(screen.queryByTestId('editor-generate-phase')).toBeNull());
      expect(screen.getByTestId('body-textarea')).toHaveValue('Hello world');
      expect(screen.getByTestId('body-textarea')).not.toBeDisabled();
    });

    it('shows an error and re-enables the body field when generation fails', async () => {
      const user = userEvent.setup();
      call.mockResolvedValue(fail('io', 'claude CLI not found in PATH'));

      renderWithQuery(
        <CustomizationEditor
          initial={basePersonalInstruction()}
          isCreate={false}
          enableGenerate
          onSaved={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      await user.click(screen.getByTestId('editor-generate-open'));
      await user.click(screen.getByTestId('editor-generate-submit'));

      expect(await screen.findByTestId('editor-generate-error')).toHaveTextContent(
        'claude CLI not found in PATH',
      );
      expect(screen.getByTestId('body-textarea')).not.toBeDisabled();
    });
  });

  describe('session panel', () => {
    it('shows a locked explanation instead of a live session while creating a new entity', () => {
      renderWithQuery(
        <CustomizationEditor initial={baseCustomization()} isCreate={true} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(screen.queryByTestId('session-open')).toBeNull();
      expect(screen.getByTestId('session-panel-locked')).toBeInTheDocument();
    });

    it('is shown for an existing entity', () => {
      renderWithQuery(
        <CustomizationEditor initial={baseCustomization()} isCreate={false} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(screen.getByTestId('session-open')).toBeInTheDocument();
      expect(screen.queryByTestId('session-panel-locked')).toBeNull();
    });
  });
});
