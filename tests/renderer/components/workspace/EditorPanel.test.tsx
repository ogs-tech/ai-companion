import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorPanel } from '../../../../src/renderer/components/workspace/EditorPanel.js';
import { mockApi, ok, fail, renderWithQuery, type CallSpy } from '../../test-utils.js';
import type { Agent, Instruction, Skill } from '../../../../src/shared/entity.js';
import type { SpreadsheetCell, SpreadsheetSheet } from '../../../../src/shared/file-browser.js';
import { createAppTheme } from '../../../../src/renderer/theme.js';

function sheet(
  name: string,
  rows: SpreadsheetCell[][],
  overrides: Partial<SpreadsheetSheet> = {},
): SpreadsheetSheet {
  return {
    name,
    rows,
    merges: [],
    columnWidths: [],
    rowHeights: [],
    frozenRows: 0,
    frozenCols: 0,
    ...overrides,
  };
}

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
const pressSave = (user: ReturnType<typeof userEvent.setup>): Promise<void> =>
  user.keyboard('{Control>}s{/Control}');

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'project.list') return ok([{ id: 'p1', name: 'Acme', path: '/repos/acme' }]);
    if (method === 'workspace.getActive')
      return ok({ id: 'w1', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' });
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
    expect(screen.getByTestId('properties-modal')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(cmContent(container)).toBeInTheDocument();
  });

  it('saves a skill via skill.save on Ctrl/Cmd+S, then calls onSaved', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    call.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'project.list') return ok([]);
      if (method === 'workspace.getActive')
        return ok({
          id: 'w1',
          name: 'Default',
          rootPath: '/home/u',
          isDefault: true,
          createdAt: '',
        });
      if (method === 'skill.save') {
        const p = params as { skill: Skill; isCreate: boolean };
        return ok({ skill: { ...p.skill, urn: 'urn:skill:acme' }, syncReport: [] });
      }
      return ok(undefined);
    });
    renderWithQuery(
      <EditorPanel
        subject="entity"
        initial={skill({ urn: '', name: 'acme' })}
        isCreate
        onSaved={onSaved}
        onDirtyChange={vi.fn()}
      />,
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
      <EditorPanel
        subject="entity"
        initial={agent()}
        isCreate={false}
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
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
    const { rerender } = renderWithQuery(
      <EditorPanel
        subject="entity"
        initial={skill({ urn: 'urn:skill:acme', name: 'acme' })}
        isCreate={false}
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    );
    // Properties lives in a modal now — opened externally (a tree row's
    // right-click "Properties" action), simulated here via the same
    // `openPropertiesRequest` prop `WorkspaceScreen` flips for that flow.
    rerender(
      <EditorPanel
        subject="entity"
        initial={skill({ urn: 'urn:skill:acme', name: 'acme' })}
        isCreate={false}
        openPropertiesRequest
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    );
    const nameField = await screen.findByLabelText('Name');
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
        return {
          ok: false,
          error: {
            kind: 'validation',
            message: 'invalid',
            details: { errors: [{ path: 'name', message: 'required' }] },
          },
        };
      }
      return ok(undefined);
    });
    renderWithQuery(
      <EditorPanel
        subject="entity"
        initial={skill()}
        isCreate={false}
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    );
    await pressSave(user);
    expect(await screen.findByText(/name: required/i)).toBeInTheDocument();
    expect(screen.getByTestId('editor-panel')).toBeInTheDocument();
  });

  it('renders the Checkbox/FormGroup scope UI for an instruction instead of the skill/agent toggle group', async () => {
    const { rerender } = renderWithQuery(
      <EditorPanel
        subject="entity"
        initial={instruction()}
        isCreate={false}
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    );
    rerender(
      <EditorPanel
        subject="entity"
        initial={instruction()}
        isCreate={false}
        openPropertiesRequest
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    );
    expect(await screen.findByRole('checkbox', { name: 'project' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Workspace' })).not.toBeInTheDocument();
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
        initial={skill({
          source: { kind: 'plugin', pluginId: 'acme-plugin', provenance: 'workspace-managed' },
        })}
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
      <EditorPanel
        subject="entity"
        initial={skill({ content: '' })}
        isCreate={false}
        onSaved={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
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
      <EditorPanel
        subject="entity"
        initial={skill({ content: '' })}
        isCreate={false}
        active={false}
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
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
      if (method === 'workspace.readFile')
        return ok({ previewable: true, kind: 'text', content: 'file body', truncated: false });
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="notes.md" onDirtyChange={vi.fn()} />);
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('workspace.readFile', { path: 'notes.md' }),
    );
    expect(await screen.findByTestId('editor-panel')).toBeInTheDocument();
  });

  it('loads content via project.readFile when scoped to a projectId', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'project.readFile')
        return ok({ previewable: true, kind: 'text', content: 'file body', truncated: false });
      return ok(undefined);
    });
    renderWithQuery(
      <EditorPanel subject="file" path="notes.md" projectId="p1" onDirtyChange={vi.fn()} />,
    );
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('project.readFile', { projectId: 'p1', path: 'notes.md' }),
    );
  });

  it('saves edits via workspace.writeFile and clears the dirty flag on Ctrl/Cmd+S', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile')
        return ok({ previewable: true, kind: 'text', content: '', truncated: false });
      if (method === 'workspace.writeFile') return ok(undefined);
      return ok(undefined);
    });
    const { container } = renderWithQuery(
      <EditorPanel subject="file" path="notes.md" onDirtyChange={onDirtyChange} />,
    );
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
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('workspace.writeFile', { path: 'notes.md', content: 'x' }),
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('never writes a truncated file — Ctrl/Cmd+S is a no-op while it stays read-only', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile')
        return ok({ previewable: true, kind: 'text', content: 'partial…', truncated: true });
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="big.txt" onDirtyChange={vi.fn()} />);
    expect(await screen.findByTestId('file-preview-truncated-notice')).toBeInTheDocument();
    await pressSave(user);
    expect(call.mock.calls.some(([method]) => method === 'workspace.writeFile')).toBe(false);
  });

  it('renders a not-previewable (binary/oversized) file as an empty state with no editor', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile')
        return ok({ previewable: false, reason: 'File appears to be binary' });
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

  it('renders a spreadsheet preview as a read-only table, with no CodeMirror editor and no write-back on save', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [
            sheet('Catalog', [
              ['Name', 'Price'],
              ['Widget', '9.99'],
            ]),
          ],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    expect(await screen.findByTestId('spreadsheet-preview')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.queryByTestId('body-editor')).not.toBeInTheDocument();

    await pressSave(user);
    expect(call.mock.calls.some(([method]) => method === 'workspace.writeFile')).toBe(false);
  });

  it('renders one tab per sheet for a multi-sheet spreadsheet and switches the visible table on click', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [sheet('First', [['alpha']]), sheet('Second', [['beta']])],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    // Scoped to the grid itself — A1 of the active sheet is also
    // auto-selected, so its text repeats in the formula bar above the grid.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('alpha')).toBeInTheDocument();
    expect(within(table).queryByText('beta')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Second' }));
    expect(await within(table).findByText('beta')).toBeInTheDocument();
    expect(within(table).queryByText('alpha')).not.toBeInTheDocument();
  });

  it('shows a truncation notice for a spreadsheet whose sheet was capped', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: true,
          sheets: [sheet('Catalog', [['a']])],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    expect(await screen.findByTestId('spreadsheet-truncated-notice')).toBeInTheDocument();
  });

  it('renders the sheet tabs below the grid, not above it', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [sheet('First', [['alpha']]), sheet('Second', [['beta']])],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    await screen.findByRole('table');
    const preview = screen.getByTestId('spreadsheet-preview');
    const order = Array.from(preview.querySelectorAll('table, [role="tablist"]')).map((el) =>
      el.tagName === 'TABLE' ? 'table' : 'tabs',
    );
    expect(order).toEqual(['table', 'tabs']);
  });

  it('renders one cell spanning two columns for a merged range, with no separate cell for the column it covers', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [
            sheet(
              'Catalog',
              [
                ['Title', ''],
                ['a', 'b'],
              ],
              { merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }] },
            ),
          ],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    // Title (A1) is also auto-selected, so it repeats in the formula bar — scope to the grid's <td>.
    const titleCell = (await screen.findAllByText('Title'))
      .map((el) => el.closest('td'))
      .find((el) => el !== null)!;
    expect(titleCell).toHaveAttribute('colspan', '2');
    // Row-number header cell is a <th>, not a <td> — so the merged data row
    // still reports exactly one <td>, the merged Title cell itself.
    expect(titleCell.closest('tr')?.querySelectorAll('td')).toHaveLength(1);
  });

  it("applies a cell's own font/fill style from the source file, taking it over the built-in first-column heuristic", async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [
            sheet('Catalog', [
              [{ value: 'Total', style: { bold: false, backgroundColor: '#ffe066' } }],
            ]),
          ],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    // Total (A1) is also auto-selected, so it repeats in the formula bar — scope to the grid's <td>.
    const cell = (await screen.findAllByText('Total'))
      .map((el) => el.closest('td'))
      .find((el) => el !== null)!;
    expect(cell).toHaveStyle({ backgroundColor: '#ffe066', fontWeight: 400 });
  });

  it('renders an unresolved formula cell with the formula text muted/italic, instead of a blank cell or a normal-looking value', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [
            sheet('Catalog', [
              [{ value: 'INDEX(A1,B1)', formula: 'INDEX(A1,B1)', formulaUnresolved: true }],
            ]),
          ],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    // The cell (A1) is also auto-selected, so its text repeats in the formula bar — scope to the grid's <td>.
    const cell = (await screen.findAllByText('INDEX(A1,B1)'))
      .map((el) => el.closest('td'))
      .find((el) => el !== null)!;
    expect(cell).toHaveStyle({
      fontStyle: 'italic',
      color: createAppTheme('light').palette.text.disabled,
    });
  });

  it('renders column-letter and row-number headers around the data grid, like a real spreadsheet', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [
            sheet('Catalog', [
              ['Widget', '9.99'],
              ['Gadget', '4.50'],
            ]),
          ],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    const grid = await screen.findByTestId('spreadsheet-preview');

    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((el) => el.textContent),
    ).toEqual(['', 'A', 'B']);
    expect(
      within(grid)
        .getAllByRole('rowheader')
        .map((el) => el.textContent),
    ).toEqual(['1', '2']);
  });

  describe('formula bar', () => {
    function formulaBarRef(): HTMLElement {
      return screen.getByTestId('spreadsheet-formula-bar-ref');
    }
    function formulaBarContent(): HTMLElement {
      return screen.getByTestId('spreadsheet-formula-bar-content');
    }

    it('selects A1 by default and shows its value in the formula bar', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'workspace.readFile') {
          return ok({
            previewable: true,
            kind: 'spreadsheet',
            truncated: false,
            sheets: [sheet('Catalog', [['Widget', '9.99']])],
          });
        }
        return ok(undefined);
      });
      renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
      await screen.findByTestId('spreadsheet-preview');

      expect(formulaBarRef()).toHaveTextContent('A1');
      expect(formulaBarContent()).toHaveTextContent('Widget');
    });

    it('shows the formula text (prefixed with "=") for a selected formula cell, not its cached value', async () => {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => {
        if (method === 'workspace.readFile') {
          return ok({
            previewable: true,
            kind: 'spreadsheet',
            truncated: false,
            sheets: [
              sheet('Catalog', [
                ['2', '3'],
                ['', { value: '5', formula: 'A1+B1' }],
              ]),
            ],
          });
        }
        return ok(undefined);
      });
      renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
      await screen.findByTestId('spreadsheet-preview');

      await user.click(screen.getByText('5'));

      expect(formulaBarRef()).toHaveTextContent('B2');
      expect(formulaBarContent()).toHaveTextContent('=A1+B1');
    });

    it('resets the selection back to A1 of the newly active sheet when switching sheet tabs', async () => {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => {
        if (method === 'workspace.readFile') {
          return ok({
            previewable: true,
            kind: 'spreadsheet',
            truncated: false,
            sheets: [sheet('First', [['alpha']]), sheet('Second', [['beta']])],
          });
        }
        return ok(undefined);
      });
      renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
      const table = await screen.findByRole('table');
      await within(table).findByText('alpha');

      await user.click(screen.getByRole('tab', { name: 'Second' }));
      await within(table).findByText('beta');

      expect(formulaBarRef()).toHaveTextContent('A1');
      expect(formulaBarContent()).toHaveTextContent('beta');
    });
  });

  it("highlights the selected cell's row-number and column-letter headers, reinforcing which row/column it's in", async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [
            sheet('Catalog', [
              ['a', 'b'],
              ['c', 'd'],
            ]),
          ],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    await screen.findByTestId('spreadsheet-preview');

    await user.click(screen.getByText('d')); // row 2, column B

    expect(screen.getByRole('rowheader', { name: '2' })).toHaveStyle({ fontWeight: '700' });
    expect(screen.getByRole('columnheader', { name: 'B' })).toHaveStyle({ fontWeight: '700' });
    expect(screen.getByRole('rowheader', { name: '1' })).toHaveStyle({ fontWeight: '600' });
    expect(screen.getByRole('columnheader', { name: 'A' })).toHaveStyle({ fontWeight: '600' });
  });

  it('gives every row (including the column-letter header) an explicit height, so sticky frozen-row/column offsets stay accurate without a real layout measurement', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [sheet('Catalog', [['a'], ['b']])],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    const table = await screen.findByRole('table');

    for (const row of within(table).getAllByRole('row')) {
      expect(row).toHaveStyle({ height: '33px' });
    }
  });

  it("lays the grid out at the file's own column widths instead of stretching them to fill the panel", async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          // 10 and 20 Excel character-widths -> 75px and 145px.
          sheets: [sheet('Catalog', [['a', 'b']], { columnWidths: [10, 20] })],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    const table = await screen.findByRole('table');

    // Under MUI's default `width: 100%` + `table-layout: auto`, a `<td>`
    // width is only a hint: the browser recomputes every column from
    // content and redistributes the slack, so one wide merged cell inflates
    // the whole sheet and the file's geometry is lost. Pinning the layout
    // to `fixed` at the summed width is what makes the declared widths
    // actually the rendered widths.
    expect(table).toHaveStyle({ tableLayout: 'fixed', width: '264px' }); // 44 row header + 75 + 145
  });

  it("sizes a column the file left unset from the sheet's own default width, falling back to Excel's 8.43-character default", async () => {
    call.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.readFile') {
        const withSheetDefault = (params as { path: string }).path === 'with-default.xlsx';
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [
            sheet('Catalog', [['a', 'b']], {
              columnWidths: [10],
              ...(withSheetDefault ? { defaultColumnWidth: 20 } : {}),
            }),
          ],
        });
      }
      return ok(undefined);
    });

    const { unmount } = renderWithQuery(
      <EditorPanel subject="file" path="with-default.xlsx" onDirtyChange={vi.fn()} />,
    );
    // 44 row header + 75 (10 chars) + 145 (the sheet's own 20-char default).
    expect(await screen.findByRole('table')).toHaveStyle({ width: '264px' });
    unmount();

    renderWithQuery(<EditorPanel subject="file" path="plain.xlsx" onDirtyChange={vi.fn()} />);
    // 44 row header + 75 (10 chars) + 64 (Excel's own 8.43-char default).
    expect(await screen.findByRole('table')).toHaveStyle({ width: '183px' });
  });

  it('breaks a wrap-text cell across lines instead of clipping it to one ellipsized line', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [
            sheet('Catalog', [
              [
                { value: 'wrapped', style: { wrapText: true } },
                { value: 'clipped', style: { bold: true } },
              ],
            ]),
          ],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    await screen.findByTestId('spreadsheet-preview');

    expect(screen.getByRole('cell', { name: 'wrapped' })).toHaveStyle({
      whiteSpace: 'pre-wrap',
      textOverflow: 'clip',
    });
    // A cell the file did NOT mark as wrapping keeps the single-line
    // ellipsis, so one long free-text cell can't stretch its whole row.
    expect(screen.getByRole('cell', { name: 'clipped' })).toHaveStyle({
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
    });
  });

  it("anchors a cell's text to the vertical alignment the file gave it, so wrapped text in a tall row starts at the top", async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [
            sheet('Catalog', [
              [{ value: 'top', style: { verticalAlign: 'top' } }, { value: 'unset' }],
            ]),
          ],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    await screen.findByTestId('spreadsheet-preview');

    expect(screen.getByRole('cell', { name: 'top' })).toHaveStyle({ verticalAlign: 'top' });
    expect(screen.getByRole('cell', { name: 'unset' })).toHaveStyle({ verticalAlign: 'middle' });
  });

  it("stacks frozen rows by their real heights, so a tall frozen row doesn't land on top of the one below it", async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [
            sheet('Catalog', [['a'], ['b'], ['c']], {
              frozenRows: 2,
              rowHeights: [60, undefined], // 60pt -> 80px; the second row has no explicit height
            }),
          ],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    await screen.findByTestId('spreadsheet-preview');

    // formula bar (36) + column-letter header (33)
    expect(screen.getByRole('rowheader', { name: '1' })).toHaveStyle({ top: '69px' });
    // ...plus row 1's REAL 80px height, not the 33px fallback baseline.
    expect(screen.getByRole('rowheader', { name: '2' })).toHaveStyle({ top: '149px' });
  });

  it('keeps the table container from establishing its own scroll/sticky context, so its sticky offsets stay relative to the tab panel that actually scrolls', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [sheet('Catalog', [['a']])],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
    const table = await screen.findByRole('table');

    // MUI's TableContainer defaults to overflow-x:auto, which (per the CSS
    // overflow spec) computes overflow-y to auto too — making it its OWN
    // nearest scrolling ancestor for any sticky descendant, independent of
    // the tab panel that actually scrolls. That silently breaks every
    // hand-computed sticky offset (formula bar height + header row height +
    // frozen-row stacking): a frozen row ends up stuck relative to the
    // TableContainer's own (usually unscrolled) top instead, landing right
    // on top of the row below it. Forcing `overflow: visible` here defers
    // scrolling to the outer panel, the single consistent sticky reference
    // frame every offset in this component assumes.
    expect(table.closest('.MuiTableContainer-root')).toHaveStyle({ overflow: 'visible' });
  });

  describe('resizing columns and rows', () => {
    it('grows a column by the pointer delta when dragging its header resize handle', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'workspace.readFile') {
          return ok({
            previewable: true,
            kind: 'spreadsheet',
            truncated: false,
            // No file-provided width, so this column both renders at and
            // drags from Excel's own 8.43-character default (64px). Under
            // the grid's fixed layout there is no "content-driven" width
            // left for an unsized column to fall back to, so the rendered
            // width and the drag baseline are necessarily the same number.
            sheets: [sheet('Catalog', [['a', 'b']])],
          });
        }
        return ok(undefined);
      });
      renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
      await screen.findByTestId('spreadsheet-preview');

      const handle = screen.getByTestId('spreadsheet-col-resize-0');
      fireEvent.mouseDown(handle, { clientX: 100 });
      fireEvent.mouseMove(window, { clientX: 140 });
      fireEvent.mouseUp(window);

      expect(screen.getByRole('columnheader', { name: 'A' })).toHaveStyle({ width: '104px' });
    });

    it('grows a row by the pointer delta when dragging its row-number resize handle', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'workspace.readFile') {
          return ok({
            previewable: true,
            kind: 'spreadsheet',
            truncated: false,
            sheets: [sheet('Catalog', [['a']], { rowHeights: [24] })], // 24pt -> 32px
          });
        }
        return ok(undefined);
      });
      renderWithQuery(<EditorPanel subject="file" path="catalog.xlsx" onDirtyChange={vi.fn()} />);
      await screen.findByTestId('spreadsheet-preview');

      const handle = screen.getByTestId('spreadsheet-row-resize-0');
      fireEvent.mouseDown(handle, { clientY: 100 });
      fireEvent.mouseMove(window, { clientY: 130 });
      fireEvent.mouseUp(window);

      expect(screen.getByRole('rowheader', { name: '1' }).closest('tr')).toHaveStyle({
        height: '62px',
      });
    });
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
      if (method === 'workspace.readFile')
        return ok({ previewable: true, kind: 'text', content: '# File', truncated: false });
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="preview" source={{ kind: 'file', path: 'notes.md' }} />);
    expect(await screen.findByTestId('markdown-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('body-editor')).not.toBeInTheDocument();
  });

  it('renders an empty state for a non-previewable file', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile')
        return ok({ previewable: false, reason: 'File appears to be binary' });
      return ok(undefined);
    });
    renderWithQuery(<EditorPanel subject="preview" source={{ kind: 'file', path: 'image.bin' }} />);
    expect(await screen.findByTestId('file-preview-not-previewable')).toBeInTheDocument();
  });

  it("renders a file's spreadsheet content as a read-only table", async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile') {
        return ok({
          previewable: true,
          kind: 'spreadsheet',
          truncated: false,
          sheets: [sheet('Catalog', [['Widget']])],
        });
      }
      return ok(undefined);
    });
    renderWithQuery(
      <EditorPanel subject="preview" source={{ kind: 'file', path: 'catalog.xlsx' }} />,
    );
    expect(await screen.findByTestId('spreadsheet-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('body-editor')).not.toBeInTheDocument();
  });
});

describe('EditorPanel — file subject, picking up work done outside the app', () => {
  /** Mocks `workspace.readFile` to serve whatever the returned box currently holds. */
  function serveFile(initial: string): { set: (content: string) => void } {
    const box = { content: initial };
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.readFile')
        return ok({ previewable: true, kind: 'text', content: box.content, truncated: false });
      return ok(undefined);
    });
    return { set: (content: string) => (box.content = content) };
  }

  const readFileCalls = (): number =>
    call.mock.calls.filter(([method]) => method === 'workspace.readFile').length;

  it('re-reads the file when its tab becomes the active one', async () => {
    serveFile('v1');
    const { rerender } = renderWithQuery(
      <EditorPanel subject="file" path="notes.md" active={false} onDirtyChange={vi.fn()} />,
    );
    await waitFor(() => expect(readFileCalls()).toBe(1));

    rerender(
      <EditorPanel subject="file" path="notes.md" active onDirtyChange={vi.fn()} />,
    );
    await waitFor(() => expect(readFileCalls()).toBe(2));
  });

  it('does not re-read on the activation that comes with the first render', async () => {
    serveFile('v1');
    renderWithQuery(
      <EditorPanel subject="file" path="notes.md" active onDirtyChange={vi.fn()} />,
    );
    await waitFor(() => expect(readFileCalls()).toBe(1));
    expect(readFileCalls()).toBe(1);
  });

  it('shows the new content when the file changed on disk', async () => {
    const file = serveFile('written by hand');
    const { container, rerender } = renderWithQuery(
      <EditorPanel subject="file" path="notes.md" active={false} onDirtyChange={vi.fn()} />,
    );
    await waitFor(() => expect(cmContent(container).textContent).toBe('written by hand'));

    file.set('rewritten by a claude session');
    rerender(<EditorPanel subject="file" path="notes.md" active onDirtyChange={vi.fn()} />);

    await waitFor(() =>
      expect(cmContent(container).textContent).toBe('rewritten by a claude session'),
    );
  });

  it('keeps an unsaved draft when a re-read returns identical content', async () => {
    const user = userEvent.setup();
    serveFile('base');
    const onDirtyChange = vi.fn();
    const { container, rerender } = renderWithQuery(
      <EditorPanel subject="file" path="notes.md" active onDirtyChange={onDirtyChange} />,
    );
    const editor = await waitFor(() => {
      const el = cmContent(container);
      if (!el) throw new Error('editor not ready');
      return el;
    });
    editor.focus();
    // skipClick, as elsewhere in this file: without real layout jsdom can't
    // resolve a caret position, so where the text lands is not meaningful —
    // only that it made the draft diverge from what's on disk.
    await user.type(editor, ' + mine', { skipClick: true });
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));
    const edited = cmContent(container).textContent;
    expect(edited).not.toBe('base');

    // Deactivate and reactivate: a full re-read round trip that finds the file
    // byte-for-byte unchanged must leave the in-progress edit alone.
    rerender(
      <EditorPanel subject="file" path="notes.md" active={false} onDirtyChange={onDirtyChange} />,
    );
    rerender(
      <EditorPanel subject="file" path="notes.md" active onDirtyChange={onDirtyChange} />,
    );
    await waitFor(() => expect(readFileCalls()).toBe(2));
    expect(cmContent(container).textContent).toBe(edited);
  });
});
