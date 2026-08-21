import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomizationEditor } from '../../../src/renderer/components/CustomizationEditor.js';
import { mockApi, ok, fail, renderWithTheme, type CallSpy } from '../test-utils.js';
import { WORKSPACE_SOURCE, type PersonalInstruction, type Skill } from '../../../src/shared/entity.js';

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

const basePersonalInstruction = (): PersonalInstruction => ({
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
    renderWithTheme(
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
    renderWithTheme(
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

    renderWithTheme(
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

  it('renders the personal scope checkbox reflecting scopes (project temporarily hidden for skill)', () => {
    const initial = baseCustomization();
    initial.scopes = ['personal'];
    renderWithTheme(
      <CustomizationEditor
        initial={initial}
        isCreate={false}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const personal = screen.getByRole('checkbox', { name: /personal/i });
    expect(personal).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /project/i })).toBeNull();
  });

  it('toggling the personal checkbox off leaves scopes empty on save', async () => {
    const user = userEvent.setup();
    const initial = baseCustomization();
    call.mockResolvedValue(
      ok({
        skill: { ...initial, scopes: [] },
        syncReport: [],
      }),
    );

    renderWithTheme(
      <CustomizationEditor
        initial={initial}
        isCreate={true}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: /personal/i }));
    await user.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        'skill.save',
        expect.objectContaining({
          skill: expect.objectContaining({ scopes: [] }),
        }),
      ),
    );
  });

  it('editing the name in edit mode still sends the original urn (so the service detects a rename)', async () => {
    const user = userEvent.setup();
    const initial = baseCustomization(); // urn 'urn:skill:foo', name 'foo'
    call.mockResolvedValue(ok({ skill: { ...initial, name: 'bar' }, syncReport: [] }));

    renderWithTheme(
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

  it('unchecking the only selected scope leaves scopes empty (validation handled by service)', async () => {
    const user = userEvent.setup();
    const initial = baseCustomization();

    renderWithTheme(
      <CustomizationEditor
        initial={initial}
        isCreate={true}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: /personal/i }));
    expect(screen.getByRole('checkbox', { name: /personal/i })).not.toBeChecked();
  });

  // TODO(follow-up): remove when skill/agent regain a per-entity repoPath and
  // 'project' scope is unblocked in the schema.
  it('does not render the project scope toggle for skill/agent (temporary block)', () => {
    renderWithTheme(
      <CustomizationEditor
        initial={baseCustomization()}
        isCreate={true}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('checkbox', { name: /project/i })).toBeNull();
  });

  // Personal instruction: name/scope are fixed AND description/version aren't
  // persisted (frontmatter-free storage). Hiding all four fields must fully
  // suppress the Frontmatter panel — otherwise the user sees empty widgets that
  // do nothing on save.
  it('hides the entire Frontmatter section when all frontmatter fields are hidden', () => {
    renderWithTheme(
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

    renderWithTheme(
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
      renderWithTheme(
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
      renderWithTheme(
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

      renderWithTheme(
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

      renderWithTheme(
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
    it('is not shown while creating a new entity', () => {
      renderWithTheme(
        <CustomizationEditor initial={baseCustomization()} isCreate={true} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(screen.queryByTestId('session-open')).toBeNull();
    });

    it('is shown for an existing entity', () => {
      renderWithTheme(
        <CustomizationEditor initial={baseCustomization()} isCreate={false} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(screen.getByTestId('session-open')).toBeInTheDocument();
    });
  });
});
