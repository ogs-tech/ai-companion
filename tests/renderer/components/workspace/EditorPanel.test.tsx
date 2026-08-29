import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorPanel } from '../../../../src/renderer/components/workspace/EditorPanel.js';
import { mockApi, ok, fail, renderWithQuery, type CallSpy } from '../../test-utils.js';
import type { Agent, Instruction, Skill } from '../../../../src/shared/entity.js';

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    urn: 'urn:skill:acme',
    kind: 'skill',
    name: 'acme',
    description: '',
    scopes: ['personal'],
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: { kind: 'workspace' },
    content: 'hello',
    ...overrides,
  };
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    urn: 'urn:agent:acme',
    kind: 'agent',
    name: 'acme',
    description: '',
    scopes: ['personal'],
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: { kind: 'workspace' },
    systemPrompt: 'you are a helpful agent',
    ...overrides,
  };
}

function instruction(overrides: Partial<Instruction> = {}): Instruction {
  return {
    urn: 'urn:instruction:acme-proj',
    kind: 'instruction',
    name: 'acme-proj',
    description: '',
    scopes: ['project'],
    scopeId: 'p1',
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: { kind: 'workspace' },
    content: 'instructions body',
    ...overrides,
  } as Instruction;
}

const cmContent = (container: HTMLElement): HTMLElement =>
  container.querySelector('[data-testid="body-editor"] .cm-content') as HTMLElement;

/** Fires the Ctrl+S save shortcut `EditorPanel` listens for on `window`. */
const pressSave = (user: ReturnType<typeof userEvent.setup>): Promise<void> => user.keyboard('{Control>}s{/Control}');

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'project.list') return ok([{ id: 'p1', name: 'Acme', path: '/repos/acme' }]);
    if (method === 'workspace.getActive') return ok({ id: 'w1', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' });
    return ok(undefined);
  });
});

describe('EditorPanel — entity subject', () => {
  it('renders the body editor with the initial content and the Properties strip expanded on create', () => {
    const { container } = renderWithQuery(
      <EditorPanel
        subject="entity"
        initial={skill({ urn: '', content: '' })}
        isCreate
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('editor-properties-toggle')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(cmContent(container)).toBeInTheDocument();
  });

  it('saves a skill via skill.save on Ctrl/Cmd+S, then calls onSaved', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    call.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'project.list') return ok([]);
      if (method === 'workspace.getActive') return ok({ id: 'w1', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' });
      if (method === 'skill.save') {
        const p = params as { skill: Skill; isCreate: boolean };
        return ok({ skill: { ...p.skill, urn: 'urn:skill:acme' }, syncReport: [] });
      }
      return ok(undefined);
    });
    renderWithQuery(
      <EditorPanel subject="entity" initial={skill({ urn: '', name: 'acme' })} isCreate onSaved={onSaved} onDirtyChange={vi.fn()} />,
    );
    await pressSave(user);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const saveCall = call.mock.calls.find(([method]) => method === 'skill.save');
    expect(saveCall?.[1]).toMatchObject({ isCreate: true, skill: { name: 'acme' } });
  });

  it('loads an agent body from systemPrompt and saves edits back to systemPrompt via agent.save', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'agent.save') {
        const p = params as { agent: Agent };
        return ok({ agent: p.agent, syncReport: [] });
      }
      return ok(undefined);
    });
    const { container } = renderWithQuery(
      <EditorPanel subject="entity" initial={agent()} isCreate={false} onSaved={vi.fn()} onDirtyChange={vi.fn()} />,
    );
    expect(cmContent(container).textContent).toBe('you are a helpful agent');
    await pressSave(user);
    await waitFor(() => {
      const saveCall = call.mock.calls.find(([method]) => method === 'agent.save');
      expect(saveCall?.[1]).toMatchObject({ agent: { systemPrompt: 'you are a helpful agent' } });
    });
    expect(call.mock.calls.some(([method]) => method === 'skill.save')).toBe(false);
  });

  it('preserves the original urn across a rename', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'skill.save') {
        const p = params as { skill: Skill };
        return ok({ skill: p.skill, syncReport: [] });
      }
      return ok(undefined);
    });
    renderWithQuery(
      <EditorPanel subject="entity" initial={skill({ urn: 'urn:skill:acme', name: 'acme' })} isCreate={false} onSaved={vi.fn()} onDirtyChange={vi.fn()} />,
    );
    await user.click(screen.getByTestId('editor-properties-toggle'));
    const nameField = screen.getByLabelText('Name');
    await user.clear(nameField);
    await user.type(nameField, 'renamed');
    await pressSave(user);
    await waitFor(() => {
      const saveCall = call.mock.calls.find(([method]) => method === 'skill.save');
      expect(saveCall?.[1]).toMatchObject({ skill: { urn: 'urn:skill:acme', name: 'renamed' } });
    });
  });

  it('shows a validation error toast without closing the panel', async () => {
    const user = userEvent.setup();
    // fail() returns an IpcResult<never> shaped error envelope with details omitted —
    // attach the errors array the component reads from IpcCallError.details directly.
    call.mockImplementation(async (method: string) => {
      if (method === 'skill.save') {
        return { ok: false, error: { kind: 'validation', message: 'invalid', details: { errors: [{ path: 'name', message: 'required' }] } } };
      }
      return ok(undefined);
    });
    renderWithQuery(
      <EditorPanel subject="entity" initial={skill()} isCreate={false} onSaved={vi.fn()} onDirtyChange={vi.fn()} />,
    );
    await pressSave(user);
    expect(await screen.findByText(/name: required/i)).toBeInTheDocument();
    expect(screen.getByTestId('editor-panel')).toBeInTheDocument();
  });

  it('renders the Checkbox/FormGroup scope UI for an instruction instead of the skill/agent toggle group', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <EditorPanel subject="entity" initial={instruction()} isCreate={false} onSaved={vi.fn()} onDirtyChange={vi.fn()} />,
    );
    await user.click(screen.getByTestId('editor-properties-toggle'));
    expect(screen.queryByRole('button', { name: 'Workspace' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'project' })).toBeInTheDocument();
  });

  it('hides frontmatter fields listed in hiddenFields while still rendering the body editor', () => {
    const { container } = renderWithQuery(
      <EditorPanel
        subject="entity"
        initial={instruction({ name: 'default', scopes: ['personal'] })}
        isCreate={false}
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
        hiddenFields={new Set(['name', 'scope', 'description', 'version'])}
      />,
    );
    expect(screen.queryByTestId('editor-properties-toggle')).not.toBeInTheDocument();
    expect(cmContent(container)).toBeInTheDocument();
  });

  it('renders a plugin-sourced entity as a read-only rendered preview, and Ctrl/Cmd+S never saves it', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <EditorPanel
        subject="entity"
        initial={skill({ source: { kind: 'plugin', pluginId: 'acme-plugin', provenance: 'workspace-managed' } })}
        isCreate={false}
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('read-only-notice')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('body-editor')).not.toBeInTheDocument();
    await pressSave(user);
    expect(call.mock.calls.some(([method]) => method === 'skill.save')).toBe(false);
  });

  it('reports dirty:true after editing the body, and dirty:false again once the save resolves', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    call.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'skill.save') {
        const p = params as { skill: Skill };
        return ok({ skill: p.skill, syncReport: [] });
      }
      return ok(undefined);
    });
    const { container } = renderWithQuery(
      <EditorPanel subject="entity" initial={skill({ content: '' })} isCreate={false} onSaved={vi.fn()} onDirtyChange={onDirtyChange} />,
    );
    const editor = cmContent(container);
    editor.focus();
    // skipClick: user-event's default type() clicks first to resolve a caret
    // position, which needs real layout — jsdom has none.
    await user.type(editor, 'x', { skipClick: true });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    await pressSave(user);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('ignores Ctrl/Cmd+S while active is false — only the visible Workbench tab responds to the shortcut', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'skill.save') {
        const p = params as { skill: Skill };
        return ok({ skill: p.skill, syncReport: [] });
      }
      return ok(undefined);
    });
    const { container } = renderWithQuery(
      <EditorPanel subject="entity" initial={skill({ content: '' })} isCreate={false} active={false} onSaved={vi.fn()} onDirtyChange={vi.fn()} />,
    );
    const editor = cmContent(container);
    editor.focus();
    await user.type(editor, 'x', { skipClick: true });
    await pressSave(user);
    expect(call.mock.calls.some(([method]) => method === 'skill.save')).toBe(false);
  });
});

describe('EditorPanel — file subject', () => {
  it('loads content via workspace.readFile when no projectId is given', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') return ok({ previewable: true, content: 'file body', truncated: false });
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="notes.md" onDirtyChange={vi.fn()} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.readFile', { path: 'notes.md' }));
    expect(await screen.findByTestId('editor-panel')).toBeInTheDocument();
  });

  it('loads content via project.readFile when scoped to a projectId', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'project.readFile') return ok({ previewable: true, content: 'file body', truncated: false });
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="notes.md" projectId="p1" onDirtyChange={vi.fn()} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('project.readFile', { projectId: 'p1', path: 'notes.md' }));
  });

  it('saves edits via workspace.writeFile and clears the dirty flag on Ctrl/Cmd+S', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') return ok({ previewable: true, content: '', truncated: false });
      if (method === 'workspace.writeFile') return ok(undefined);
      return ok(undefined);
    });
    const { container } = renderWithQuery(<EditorPanel subject="file" path="notes.md" onDirtyChange={onDirtyChange} />);
    const editor = await waitFor(() => {
      const el = cmContent(container);
      if (!el) throw new Error('editor not ready');
      return el;
    });
    editor.focus();
    // skipClick: user-event's default type() clicks first to resolve a caret
    // position, which needs real layout — jsdom has none.
    await user.type(editor, 'x', { skipClick: true });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    await pressSave(user);
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.writeFile', { path: 'notes.md', content: 'x' }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('never writes a truncated file — Ctrl/Cmd+S is a no-op while it stays read-only', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') return ok({ previewable: true, content: 'partial…', truncated: true });
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="big.txt" onDirtyChange={vi.fn()} />);
    expect(await screen.findByTestId('file-preview-truncated-notice')).toBeInTheDocument();
    await pressSave(user);
    expect(call.mock.calls.some(([method]) => method === 'workspace.writeFile')).toBe(false);
  });

  it('renders a not-previewable (binary/oversized) file as an empty state with no editor', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') return ok({ previewable: false, reason: 'File appears to be binary' });
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="image.bin" onDirtyChange={vi.fn()} />);
    expect(await screen.findByTestId('file-preview-not-previewable')).toBeInTheDocument();
    expect(screen.queryByTestId('body-editor')).not.toBeInTheDocument();
  });

  it('renders an error state when the read fails', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') return fail('internal', 'boom');
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="notes.md" onDirtyChange={vi.fn()} />);
    expect(await screen.findByTestId('file-preview-error')).toBeInTheDocument();
  });
});

describe('EditorPanel — preview subject', () => {
  it("renders an entity's already-loaded body as read-only rendered Markdown", () => {
    renderWithQuery(<EditorPanel subject="preview" source={{ kind: 'entity', body: '# Hello' }} />);
    expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('body-editor')).not.toBeInTheDocument();
  });

  it("fetches and renders a file's content as read-only rendered Markdown", async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') return ok({ previewable: true, content: '# File', truncated: false });
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="preview" source={{ kind: 'file', path: 'notes.md' }} />);
    expect(await screen.findByTestId('markdown-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('body-editor')).not.toBeInTheDocument();
  });

  it('renders an empty state for a non-previewable file', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') return ok({ previewable: false, reason: 'File appears to be binary' });
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="preview" source={{ kind: 'file', path: 'image.bin' }} />);
    expect(await screen.findByTestId('file-preview-not-previewable')).toBeInTheDocument();
  });
});
