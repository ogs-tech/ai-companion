import { useEffect, useEffectEvent, useState } from 'react';
import {
  Alert,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { FileX, X } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { EmptyState } from '../ds/EmptyState.js';
import { MarkdownBody } from '../ds/MarkdownBodyView.js';
import { PropertiesForm, type EditableEntity, type EditorHiddenField } from './PropertiesForm.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { SyncReportModal } from '../SyncReportModal.js';
import { ReadOnlyNotice } from '../ReadOnlyNotice.js';
import { entityUrn, isWorkspaceSource } from '../../../shared/entity.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import type {
  SpreadsheetCell,
  SpreadsheetCellStyle,
  SpreadsheetMerge,
  SpreadsheetSheet,
} from '../../../shared/file-browser.js';
import { entityBody, withEntityBody } from '../../lib/entity-body.js';
import { useFilePreview, useWriteFile } from '../../hooks/use-file-browser.js';
import { languageForPath } from '../../lib/code-language.js';
import { fonts } from '../../tokens.js';

export type { EditableEntity, EditorHiddenField };

export type PreviewSource =
  | { kind: 'file'; path: string; projectId?: string }
  | { kind: 'entity'; body: string };

const SAVE_BY_KIND: Record<
  EditableEntity['kind'],
  { method: string; payloadKey: string; resultKey: string }
> = {
  skill: { method: 'skill.save', payloadKey: 'skill', resultKey: 'skill' },
  agent: { method: 'agent.save', payloadKey: 'agent', resultKey: 'agent' },
  instruction: { method: 'instruction.save', payloadKey: 'instruction', resultKey: 'instruction' },
};

function fileTitle(path: string): string {
  return path.split('/').pop() || path;
}

/** A small, fixed allowlist of the frontmatter fields the Properties form actually edits — deliberately not a full-entity diff, so server-touched fields (metadata.updatedAt, source, urn) never make a just-loaded tab register as dirty. */
function propertiesSnapshot(e: EditableEntity): string {
  return JSON.stringify({
    name: e.name,
    description: e.description,
    version: e.metadata.version,
    scopes: e.scopes,
    scopeId: 'scopeId' in e ? e.scopeId : undefined,
  });
}

/**
 * Ctrl/Cmd+S triggers `onSave`, but only while this tab is the one currently
 * visible — every open Workbench tab's `EditorPanel` stays mounted the whole
 * time (WorkbenchCanvas only toggles CSS `display`), so an unscoped listener
 * would fire the shortcut on every open tab at once. `useEffectEvent` keeps
 * the effect itself only dependent on `active`, so the listener isn't torn
 * down and rebuilt on every keystroke.
 */
function useSaveShortcut(active: boolean, onSave: () => void): void {
  const triggerSave = useEffectEvent(onSave);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      triggerSave();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

export type EditorPanelProps =
  | {
      subject: 'entity';
      initial: EditableEntity;
      isCreate: boolean;
      /** Whether this tab is the one currently visible in the Workbench canvas — gates the Ctrl/Cmd+S listener. Defaults to `true`, so a panel rendered outside the canvas (e.g. in a test) still responds to the shortcut. */
      active?: boolean;
      onSaved: (saved: EditableEntity) => void | Promise<void>;
      onDirtyChange: (dirty: boolean) => void;
      hiddenFields?: ReadonlySet<EditorHiddenField>;
      /** Flips to `true` to open the Properties modal from outside (e.g. a tree row's right-click "Properties" action) — a one-shot signal, consumed via `onPropertiesRequestHandled`. */
      openPropertiesRequest?: boolean;
      onPropertiesRequestHandled?: () => void;
    }
  | {
      subject: 'file';
      path: string;
      projectId?: string;
      /** See the `entity` variant's `active`. */
      active?: boolean;
      onDirtyChange: (dirty: boolean) => void;
    }
  | {
      subject: 'preview';
      /** Read-only rendered Markdown — a file's raw content (fetched here) or an already-loaded entity body. Never dirty, never saved; closes like any other tab via the Workbench tab strip itself. */
      source: PreviewSource;
    };

/** The single Sublime-like editing surface for every Workbench tab: a plain file (raw CodeMirror text), an entity (Skill/Agent/Instruction — a "special file" with a properties form above its Markdown body), or a read-only rendered preview. */
export function EditorPanel(props: EditorPanelProps): React.ReactElement {
  if (props.subject === 'entity') return <EntitySubject {...props} />;
  if (props.subject === 'file') return <FileSubject {...props} />;
  return <PreviewSubject {...props} />;
}

type EntitySubjectProps = Extract<EditorPanelProps, { subject: 'entity' }>;

function EntitySubject({
  initial,
  isCreate,
  active = true,
  onSaved,
  onDirtyChange,
  hiddenFields,
  openPropertiesRequest,
  onPropertiesRequestHandled,
}: EntitySubjectProps): React.ReactElement {
  // Plugin-provided entities can't be saved (OperationNotAllowedForOriginError
  // on the backend) — this tab becomes a read-only viewer instead of an editor.
  const readOnly = !isWorkspaceSource(initial.source);
  const pluginSource = initial.source.kind === 'plugin' ? initial.source : null;

  const [entity, setEntity] = useState<EditableEntity>(initial);
  const [body, setBody] = useState(entityBody(initial));
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncReport, setSyncReport] = useState<SyncResult[]>([]);
  // Properties (Name/Description/Version/Scope) live in a modal now, not an
  // inline section — a brand new entity opens straight into it (nothing to
  // save yet without a Name), while an existing one only opens it on request
  // (the tree row's right-click "Properties" action, via `openPropertiesRequest`
  // — already `true` on this very first render when that request is what
  // caused the tab to be created in the first place, not just a later change).
  const [propertiesOpen, setPropertiesOpen] = useState(isCreate || Boolean(openPropertiesRequest));
  // Adjusting local state from a prop change, done during render (React's
  // sanctioned "derive state from a changed prop" pattern — same shape as
  // FileSubject's `draft` seeding below) rather than in an effect, so this
  // request-to-open never fights the "cascading setState in an effect" lint
  // rule. Separately, notifying the parent that the request was consumed
  // (`onPropertiesRequestHandled`) IS an external-system effect, so that part
  // stays in a real `useEffect`.
  const [prevPropertiesRequest, setPrevPropertiesRequest] = useState(openPropertiesRequest);
  if (openPropertiesRequest !== prevPropertiesRequest) {
    setPrevPropertiesRequest(openPropertiesRequest);
    if (openPropertiesRequest) setPropertiesOpen(true);
  }
  const notifyPropertiesRequestHandled = useEffectEvent(() => {
    onPropertiesRequestHandled?.();
  });
  useEffect(() => {
    if (openPropertiesRequest) notifyPropertiesRequestHandled();
  }, [openPropertiesRequest]);

  const [baseline, setBaseline] = useState(() => ({
    props: propertiesSnapshot(initial),
    body: entityBody(initial),
  }));
  const isDirty =
    !readOnly && (propertiesSnapshot(entity) !== baseline.props || body !== baseline.body);
  const notifyDirtyChange = useEffectEvent((dirty: boolean) => {
    onDirtyChange(dirty);
  });
  useEffect(() => {
    notifyDirtyChange(isDirty);
  }, [isDirty]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      // Preserve the original URN on edit so EntityService detects a name change
      // as a rename (old previousUrn !== new urn) instead of writing a duplicate.
      // On create the entity carries urn '' (from blankCustomization), so derive it.
      const urn = entity.urn || entityUrn(entity.kind, entity.name);
      const toSave = withEntityBody({ ...entity, urn }, body);
      const { method, payloadKey, resultKey } = SAVE_BY_KIND[toSave.kind];
      const result = await callIpc<Record<string, unknown>>(method, {
        [payloadKey]: toSave,
        isCreate,
      });
      const saved = result[resultKey] as EditableEntity;
      const report = (result['syncReport'] as SyncResult[] | undefined) ?? [];

      setEntity(saved);
      setBody(entityBody(saved));
      setBaseline({ props: propertiesSnapshot(saved), body: entityBody(saved) });

      setToast({ variant: 'success', message: `${saved.name} salvo` });
      if (report.some((entry) => entry.status !== 'ok')) setSyncReport(report);
      await onSaved(saved);
    } catch (err) {
      if (
        err instanceof IpcCallError &&
        err.kind === 'validation' &&
        Array.isArray(err.details?.errors)
      ) {
        const errors = err.details.errors as Array<{ path: string; message: string }>;
        const list = errors.map((e) => `${e.path}: ${e.message}`).join('\n');
        setToast({ variant: 'error', message: `${errors.length} validation error(s)\n${list}` });
      } else {
        setToast({
          variant: 'error',
          message: err instanceof IpcCallError ? err.message : String(err),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  useSaveShortcut(active, () => {
    if (readOnly || saving) return;
    void handleSave();
  });

  const isHidden = (field: EditorHiddenField): boolean => hiddenFields?.has(field) ?? false;
  const showFrontmatter =
    !isHidden('name') || !isHidden('description') || !isHidden('version') || !isHidden('scope');

  return (
    <Box
      data-testid="editor-panel"
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}
    >
      {readOnly && pluginSource && (
        <Box sx={{ px: 2, pt: 2, flexShrink: 0 }}>
          <ReadOnlyNotice pluginId={pluginSource.pluginId} />
        </Box>
      )}

      <Box sx={{ px: 2, py: 2 }}>
        <MarkdownBody
          mode={readOnly ? 'preview' : 'edit'}
          body={body}
          onChangeBody={setBody}
          disabled={readOnly}
          language="markdown"
        />
      </Box>

      {showFrontmatter && (
        <Dialog
          open={propertiesOpen}
          onClose={() => setPropertiesOpen(false)}
          maxWidth="sm"
          fullWidth
          data-testid="properties-modal"
        >
          <DialogTitle
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            Properties
            <IconButton size="small" aria-label="Fechar" onClick={() => setPropertiesOpen(false)}>
              <Icon glyph={X} size={16} />
            </IconButton>
          </DialogTitle>
          <DialogContent>
            <PropertiesForm
              entity={entity}
              onChange={setEntity}
              {...(hiddenFields ? { hiddenFields } : {})}
              readOnly={readOnly}
            />
          </DialogContent>
        </Dialog>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <SyncReportModal report={syncReport} onClose={() => setSyncReport([])} />
    </Box>
  );
}

type FileSubjectProps = Extract<EditorPanelProps, { subject: 'file' }>;

function FileSubject({
  path,
  projectId,
  active = true,
  onDirtyChange,
}: FileSubjectProps): React.ReactElement {
  const {
    data: preview,
    isLoading,
    isError,
    error,
  } = useFilePreview(path, { ...(projectId ? { projectId } : {}) });
  const writeFile = useWriteFile();

  const [draft, setDraft] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // Seed the draft once, the first time a previewable text file's content
  // arrives — an in-render adjustment (not an effect) guarded by
  // `draft === null`, so it fires exactly once and converges: after the
  // first `setDraft` call the guard is false on every later render, so a
  // background refetch (e.g. the cache update after this tab's own save)
  // never clobbers in-progress edits. A spreadsheet preview never seeds a
  // draft — it has no text body to edit yet.
  if (preview?.previewable && preview.kind === 'text' && draft === null) {
    setDraft(preview.content);
    setBaseline(preview.content);
  }

  const isDirty = draft !== null && baseline !== null && draft !== baseline;
  const notifyDirtyChange = useEffectEvent((dirty: boolean) => {
    onDirtyChange(dirty);
  });
  useEffect(() => {
    notifyDirtyChange(isDirty);
  }, [isDirty]);

  // Truncated files never round-trip through Save — writing back a
  // 256KB-truncated in-memory buffer as if it were the whole file would
  // silently discard its untruncated tail. Spreadsheets are view-only for
  // now — there's no write-back path for the parsed grid yet.
  const editable =
    preview?.previewable === true && preview.kind === 'text' && preview.truncated === false;

  const handleSave = async (): Promise<void> => {
    if (draft === null) return;
    setSaving(true);
    try {
      await writeFile.mutateAsync({ path, content: draft, ...(projectId ? { projectId } : {}) });
      setBaseline(draft);
      setToast({ variant: 'success', message: `${fileTitle(path)} salvo` });
    } catch (err) {
      setToast({
        variant: 'error',
        message: err instanceof IpcCallError ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  useSaveShortcut(active, () => {
    if (!editable || saving) return;
    void handleSave();
  });

  let body: React.ReactNode;
  if (isError) {
    body = (
      <Box data-testid="file-preview-error">
        <EmptyState
          glyph={FileX}
          title="Não foi possível carregar o arquivo"
          description={error instanceof Error ? error.message : 'Tente novamente.'}
          testId="file-preview-error"
        />
      </Box>
    );
  } else if (isLoading || !preview) {
    body = <Box data-testid="file-preview-loading" />;
  } else if (!preview.previewable) {
    body = (
      <Box data-testid="file-preview-not-previewable">
        <EmptyState
          glyph={FileX}
          title="Não é possível pré-visualizar"
          description={preview.reason}
          testId="file-preview-reason"
        />
      </Box>
    );
  } else if (preview.kind === 'spreadsheet') {
    body = <SpreadsheetPreview sheets={preview.sheets} truncated={preview.truncated} />;
  } else if (draft === null) {
    body = <Box data-testid="file-preview-loading" />;
  } else {
    const truncatedNotice = preview.truncated && (
      <Alert severity="info" data-testid="file-preview-truncated-notice" sx={{ mb: 1.5 }}>
        Arquivo grande — mostrando apenas o início. Edição desabilitada para não gravar um arquivo
        incompleto.
      </Alert>
    );
    body = (
      <>
        {truncatedNotice}
        <MarkdownBody
          mode="edit"
          body={draft}
          onChangeBody={setDraft}
          disabled={!editable}
          language={languageForPath(path)}
        />
      </>
    );
  }

  return (
    <Box
      data-testid="editor-panel"
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}
    >
      <Box sx={{ px: 2, py: 2, flex: 1 }}>{body}</Box>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}

type PreviewSubjectProps = Extract<EditorPanelProps, { subject: 'preview' }>;

function PreviewSubject({ source }: PreviewSubjectProps): React.ReactElement {
  return (
    <Box data-testid="editor-panel" sx={{ height: '100%', overflow: 'auto', px: 2, py: 2 }}>
      {source.kind === 'entity' ? (
        <MarkdownBody
          mode="preview"
          body={source.body}
          onChangeBody={() => {}}
          disabled
          language="markdown"
        />
      ) : (
        <FilePreviewBody
          path={source.path}
          {...(source.projectId ? { projectId: source.projectId } : {})}
        />
      )}
    </Box>
  );
}

function FilePreviewBody({
  path,
  projectId,
}: {
  path: string;
  projectId?: string;
}): React.ReactElement {
  const {
    data: preview,
    isLoading,
    isError,
    error,
  } = useFilePreview(path, { ...(projectId ? { projectId } : {}) });

  if (isError) {
    return (
      <Box data-testid="file-preview-error">
        <EmptyState
          glyph={FileX}
          title="Não foi possível carregar o arquivo"
          description={error instanceof Error ? error.message : 'Tente novamente.'}
          testId="file-preview-error"
        />
      </Box>
    );
  }
  if (isLoading || !preview) return <Box data-testid="file-preview-loading" />;
  if (!preview.previewable) {
    return (
      <Box data-testid="file-preview-not-previewable">
        <EmptyState
          glyph={FileX}
          title="Não é possível pré-visualizar"
          description={preview.reason}
          testId="file-preview-reason"
        />
      </Box>
    );
  }
  if (preview.kind === 'spreadsheet')
    return <SpreadsheetPreview sheets={preview.sheets} truncated={preview.truncated} />;
  return (
    <MarkdownBody
      mode="preview"
      body={preview.content}
      onChangeBody={() => {}}
      disabled
      language="markdown"
    />
  );
}

/** True when a stringified cell round-trips through `Number()` cleanly — used to right-align figures the way spreadsheets conventionally do, when the source file didn't specify an explicit alignment for that cell. */
function isNumericCell(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== '' && !Number.isNaN(Number(trimmed));
}

function cellText(cell: SpreadsheetCell): string {
  return typeof cell === 'string' ? cell : cell.value;
}

/** `undefined` for a plain-string cell — the source file carried no style for it, so the grid's own heuristics (first-column emphasis, numeric right-align) apply instead. */
function cellStyle(cell: SpreadsheetCell): SpreadsheetCellStyle | undefined {
  return typeof cell === 'string' ? undefined : cell.style;
}

/** The formula text (e.g. `A1+A2`), for a cell the source file recorded one for — `undefined` for a plain value. */
function cellFormula(cell: SpreadsheetCell): string | undefined {
  return typeof cell === 'string' ? undefined : cell.formula;
}

/** `true` when neither the source file's cache nor the fallback computation could produce a value — `cellText` is then the formula itself, rendered muted rather than as a normal result. */
function cellFormulaUnresolved(cell: SpreadsheetCell): boolean {
  return typeof cell === 'string' ? false : (cell.formulaUnresolved ?? false);
}

/** What the formula bar shows for a selected cell: the literal `=formula` expression (the Excel/Numbers/LibreOffice convention) when the cell has one, its plain displayed value otherwise. */
function formulaBarText(cell: SpreadsheetCell): string {
  const formula = cellFormula(cell);
  return formula ? `=${formula}` : cellText(cell);
}

/** Excel's column width is "characters of the default font" — the same character-to-pixel approximation spreadsheet tooling commonly uses to translate it into a CSS width. */
function columnWidthPx(width: number | undefined): number | undefined {
  return width === undefined ? undefined : Math.round(width * 7 + 5);
}

/** Excel row height is stored in points; at 96dpi a CSS pixel is 3/4 of a point, so converting the other way multiplies by 4/3. */
function rowHeightPx(height: number | undefined): number | undefined {
  return height === undefined ? undefined : Math.round(height * (4 / 3));
}

/** 0-based column index to its spreadsheet letter: A, B, …, Z, AA, AB, … */
function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * Fallback row height, applied as an EXPLICIT `<TableRow>` height whenever a
 * row has no file-provided or resized height — not just a visual nicety:
 * the sticky top offsets for frozen rows/the column-letter header are
 * computed from this same constant, so an unset row must actually render at
 * exactly this height or a frozen row drifts onto — and visually hides —
 * the row below it once scrolled (auto/content-driven height would make the
 * real rendered height diverge from what the sticky math assumes).
 */
const FROZEN_ROW_HEIGHT_PX = 33;
/** The synthetic top row of column letters (A, B, C…) renders at the same height as a data row under dense styling. */
const COLUMN_HEADER_ROW_HEIGHT_PX = FROZEN_ROW_HEIGHT_PX;
/** The formula bar sits above the grid itself, outside the frozen-row sticky stack. */
const FORMULA_BAR_HEIGHT_PX = 36;
/** Width of the sticky row-number column on the left — enough for a 4-digit row number plus its resize handle. */
const ROW_HEADER_WIDTH_PX = 44;
/** Starting point for a drag-resize on a column the source file never set an explicit width for. Never applied to an unresized column's own rendered width, which stays content-driven — same auto-width behavior the grid already had before headers existed. */
const DEFAULT_COLUMN_WIDTH_PX = 120;
const MIN_COLUMN_WIDTH_PX = 32;
const MIN_ROW_HEIGHT_PX = 20;

/** From a sheet's merge list: which cell positions a merge covers besides its own top-left anchor (skipped on render, since the anchor's colSpan/rowSpan already accounts for them), keyed by the anchor position for the ones that need those span attributes. */
function buildMergeIndex(merges: SpreadsheetMerge[]): {
  anchors: Map<string, SpreadsheetMerge>;
  covered: Set<string>;
} {
  const anchors = new Map<string, SpreadsheetMerge>();
  const covered = new Set<string>();
  for (const merge of merges) {
    anchors.set(`${merge.row}:${merge.col}`, merge);
    for (let r = merge.row; r < merge.row + merge.rowSpan; r += 1) {
      for (let c = merge.col; c < merge.col + merge.colSpan; c += 1) {
        if (r !== merge.row || c !== merge.col) covered.add(`${r}:${c}`);
      }
    }
  }
  return { anchors, covered };
}

interface SelectedCell {
  sheet: number;
  row: number;
  col: number;
}

/**
 * A read-only grid for a parsed `.xlsx` workbook, styled after a real
 * spreadsheet (Excel/Numbers/LibreOffice) rather than a generic data table:
 * sticky column-letter (A, B, C…) and row-number (1, 2, 3…) headers frame
 * the grid, a formula bar above it shows the selected cell's reference and
 * content — the literal `=formula` text for a formula cell (a small corner
 * marker on the cell itself flags that it has one, since the source file's
 * cached result alone doesn't say how a value was derived) — and dragging a
 * header's edge resizes that column/row for this viewing session only:
 * there's no write-back path for `.xlsx`, so a resize is never persisted
 * and resets the next time the file is opened. Sheet tabs sit at the bottom
 * of the grid — where native spreadsheet apps put them — and scroll
 * horizontally when there are more sheets than fit. A merged range renders
 * as one cell with the matching colSpan/rowSpan; a cell's own
 * font/fill/alignment from the source file wins over this grid's built-in
 * heuristics (first-column emphasis, numeric right-align), which only kick
 * in for a cell the file left unstyled. A frozen header row/column, when
 * the sheet has one, stays pinned while the body scrolls — the same sticky
 * mechanism the column/row headers use, just applied one layer further in.
 * Each cell is width-capped with a single-line ellipsis (full value
 * available via the native `title` tooltip on hover) — without that cap, a
 * long free-text cell (a legend, a note) forces its row to wrap across many
 * lines while every other row in the sheet stays single-line, which is what
 * broke the layout: rows lose a consistent height and columns drift out of
 * alignment with the header above them. No cell editing yet: the
 * main-process side only reads spreadsheets, it doesn't write them back.
 */
function SpreadsheetPreview({
  sheets,
  truncated,
}: {
  sheets: SpreadsheetSheet[];
  truncated: boolean;
}): React.ReactElement {
  const [activeSheet, setActiveSheet] = useState(0);
  const [colWidthOverrides, setColWidthOverrides] = useState<
    Record<number, Record<number, number>>
  >({});
  const [rowHeightOverrides, setRowHeightOverrides] = useState<
    Record<number, Record<number, number>>
  >({});
  const [selected, setSelected] = useState<SelectedCell>({ sheet: 0, row: 0, col: 0 });

  // A sheet switch always re-selects that sheet's A1 — an in-render
  // adjustment (React's sanctioned "derive state from a changed prop/state"
  // pattern, same shape as EntitySubject's `prevPropertiesRequest` above)
  // rather than an effect, so it converges in the same render as the switch.
  if (selected.sheet !== activeSheet) {
    setSelected({ sheet: activeSheet, row: 0, col: 0 });
  }

  const sheet = sheets[activeSheet] ?? sheets[0];
  const { anchors, covered } = buildMergeIndex(sheet?.merges ?? []);
  const columnCount = sheet?.rows[0]?.length ?? 0;

  const columnWidth = (colIndex: number): number | undefined =>
    colWidthOverrides[activeSheet]?.[colIndex] ?? columnWidthPx(sheet?.columnWidths[colIndex]);
  const rowHeight = (rowIndex: number): number | undefined =>
    rowHeightOverrides[activeSheet]?.[rowIndex] ?? rowHeightPx(sheet?.rowHeights[rowIndex]);

  /** Sticky left offset for a frozen data column — the row-number column's own width plus every earlier frozen column's effective width. */
  const frozenColumnLeft = (colIndex: number): number => {
    let left = ROW_HEADER_WIDTH_PX;
    for (let c = 0; c < colIndex; c += 1) left += columnWidth(c) ?? DEFAULT_COLUMN_WIDTH_PX;
    return left;
  };

  // Drag math is delta-from-drag-start against a fixed base captured once at
  // mousedown, not delta-since-last-move — so a `mousemove` handler can be
  // idempotent (overwrite, not accumulate) and never drifts across a long
  // drag with many intermediate events.
  const startColumnResize =
    (colIndex: number) =>
    (e: React.MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const baseWidth = columnWidth(colIndex) ?? DEFAULT_COLUMN_WIDTH_PX;
      const onMove = (moveEvent: MouseEvent): void => {
        const next = Math.max(
          MIN_COLUMN_WIDTH_PX,
          Math.round(baseWidth + (moveEvent.clientX - startX)),
        );
        setColWidthOverrides((prev) => ({
          ...prev,
          [activeSheet]: { ...prev[activeSheet], [colIndex]: next },
        }));
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

  const startRowResize =
    (rowIndex: number) =>
    (e: React.MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const baseHeight = rowHeight(rowIndex) ?? FROZEN_ROW_HEIGHT_PX;
      const onMove = (moveEvent: MouseEvent): void => {
        const next = Math.max(
          MIN_ROW_HEIGHT_PX,
          Math.round(baseHeight + (moveEvent.clientY - startY)),
        );
        setRowHeightOverrides((prev) => ({
          ...prev,
          [activeSheet]: { ...prev[activeSheet], [rowIndex]: next },
        }));
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

  const selectedCell = sheet?.rows[selected.row]?.[selected.col];
  const selectedRefLabel = `${columnLetter(selected.col)}${selected.row + 1}`;

  return (
    <Box data-testid="spreadsheet-preview">
      {truncated && (
        <Alert severity="info" data-testid="spreadsheet-truncated-notice" sx={{ mb: 1.5 }}>
          Planilha grande — mostrando apenas as primeiras linhas de cada aba.
        </Alert>
      )}
      {!sheet || sheet.rows.length === 0 ? (
        <EmptyState
          glyph={FileX}
          title="Aba vazia"
          description="Esta planilha não tem linhas para mostrar."
          testId="spreadsheet-empty"
        />
      ) : (
        <>
          <Box
            data-testid="spreadsheet-formula-bar"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              height: FORMULA_BAR_HEIGHT_PX,
              px: 1,
              position: 'sticky',
              top: 0,
              zIndex: 4,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderBottom: 0,
              fontFamily: fonts.mono,
              fontSize: '0.8125rem',
            }}
          >
            <Box
              data-testid="spreadsheet-formula-bar-ref"
              sx={{ minWidth: ROW_HEADER_WIDTH_PX, fontWeight: 600, color: 'text.secondary' }}
            >
              {selectedRefLabel}
            </Box>
            <Box component="span" sx={{ color: 'text.disabled', flexShrink: 0 }}>
              fx
            </Box>
            <Box
              data-testid="spreadsheet-formula-bar-content"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {selectedCell !== undefined ? formulaBarText(selectedCell) : ''}
            </Box>
          </Box>
          <TableContainer
            component={Paper}
            sx={{ overflow: 'visible', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
          >
            <Table size="small" sx={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <TableHead>
                <TableRow sx={{ height: COLUMN_HEADER_ROW_HEIGHT_PX }}>
                  <TableCell
                    data-testid="spreadsheet-corner-header"
                    sx={(theme) => ({
                      position: 'sticky',
                      top: FORMULA_BAR_HEIGHT_PX,
                      left: 0,
                      zIndex: 3,
                      width: ROW_HEADER_WIDTH_PX,
                      minWidth: ROW_HEADER_WIDTH_PX,
                      bgcolor: theme.ogs.surfaces.rail,
                      border: 1,
                      borderColor: 'divider',
                    })}
                  />
                  {Array.from({ length: columnCount }, (_, colIndex) => {
                    const isActiveColumn = selected.col === colIndex;
                    return (
                      <TableCell
                        key={colIndex}
                        sx={(theme) => ({
                          position: 'sticky',
                          top: FORMULA_BAR_HEIGHT_PX,
                          zIndex: colIndex < sheet.frozenCols ? 2 : 1,
                          ...(colIndex < sheet.frozenCols && { left: frozenColumnLeft(colIndex) }),
                          width: columnWidth(colIndex),
                          fontFamily: fonts.mono,
                          fontSize: '0.75rem',
                          fontWeight: isActiveColumn ? 700 : 600,
                          textAlign: 'center',
                          bgcolor: isActiveColumn
                            ? alpha(theme.palette.secondary.main, 0.14)
                            : theme.ogs.surfaces.rail,
                          color: isActiveColumn ? theme.palette.secondary.main : undefined,
                          border: 1,
                          borderColor: 'divider',
                          userSelect: 'none',
                        })}
                      >
                        {columnLetter(colIndex)}
                        <Box
                          aria-hidden
                          data-testid={`spreadsheet-col-resize-${colIndex}`}
                          onMouseDown={startColumnResize(colIndex)}
                          sx={{
                            position: 'absolute',
                            top: 0,
                            right: 0,
                            bottom: 0,
                            width: 6,
                            cursor: 'col-resize',
                            '&:hover': { bgcolor: 'primary.main', opacity: 0.4 },
                          }}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableHead>
              <TableBody>
                {sheet.rows.map((row, rowIndex) => {
                  const height = rowHeight(rowIndex);
                  const frozenRow = rowIndex < sheet.frozenRows;
                  const isActiveRow = selected.row === rowIndex;
                  return (
                    <TableRow key={rowIndex} sx={{ height: height ?? FROZEN_ROW_HEIGHT_PX }}>
                      <TableCell
                        component="th"
                        scope="row"
                        data-testid={`spreadsheet-row-header-${rowIndex}`}
                        sx={(theme) => ({
                          position: 'sticky',
                          left: 0,
                          zIndex: frozenRow ? 2 : 1,
                          ...(frozenRow && {
                            top:
                              FORMULA_BAR_HEIGHT_PX +
                              COLUMN_HEADER_ROW_HEIGHT_PX +
                              rowIndex * FROZEN_ROW_HEIGHT_PX,
                          }),
                          width: ROW_HEADER_WIDTH_PX,
                          minWidth: ROW_HEADER_WIDTH_PX,
                          fontFamily: fonts.mono,
                          fontSize: '0.75rem',
                          fontWeight: isActiveRow ? 700 : 600,
                          textAlign: 'center',
                          bgcolor: isActiveRow
                            ? alpha(theme.palette.secondary.main, 0.14)
                            : theme.ogs.surfaces.rail,
                          color: isActiveRow ? theme.palette.secondary.main : undefined,
                          border: 1,
                          borderColor: 'divider',
                          userSelect: 'none',
                        })}
                      >
                        {rowIndex + 1}
                        <Box
                          aria-hidden
                          data-testid={`spreadsheet-row-resize-${rowIndex}`}
                          onMouseDown={startRowResize(rowIndex)}
                          sx={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: 6,
                            cursor: 'row-resize',
                            '&:hover': { bgcolor: 'primary.main', opacity: 0.4 },
                          }}
                        />
                      </TableCell>
                      {row.map((cell, cellIndex) => {
                        if (covered.has(`${rowIndex}:${cellIndex}`)) return null;
                        const merge = anchors.get(`${rowIndex}:${cellIndex}`);
                        const text = cellText(cell);
                        const style = cellStyle(cell);
                        const hasFormula = cellFormula(cell) !== undefined;
                        const unresolved = cellFormulaUnresolved(cell);
                        const isLabelColumn = cellIndex === 0;
                        const numeric = isNumericCell(text);
                        const align = style?.align ?? (numeric ? 'right' : 'left');
                        const bold = style ? (style.bold ?? false) : isLabelColumn;
                        const widthPx = columnWidth(cellIndex);
                        const frozenCol = cellIndex < sheet.frozenCols;
                        const isSelected = selected.row === rowIndex && selected.col === cellIndex;
                        return (
                          <TableCell
                            key={cellIndex}
                            title={text}
                            colSpan={merge?.colSpan ?? 1}
                            rowSpan={merge?.rowSpan ?? 1}
                            aria-selected={isSelected}
                            onClick={() =>
                              setSelected({ sheet: activeSheet, row: rowIndex, col: cellIndex })
                            }
                            sx={(theme) => {
                              const resolvedBackground =
                                style?.backgroundColor ??
                                (isLabelColumn
                                  ? theme.ogs.surfaces.rail
                                  : theme.palette.background.paper);
                              return {
                                position: 'relative',
                                fontFamily: fonts.mono,
                                fontSize: '0.8125rem',
                                lineHeight: 1.5,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                cursor: 'default',
                                width: widthPx,
                                maxWidth: widthPx ?? (isLabelColumn ? 420 : 280),
                                minWidth: widthPx ?? (isLabelColumn ? 160 : 90),
                                border: 1,
                                borderColor: 'divider',
                                textAlign: align,
                                fontWeight: bold ? 600 : 400,
                                fontStyle: style?.italic || unresolved ? 'italic' : 'normal',
                                ...(unresolved
                                  ? { color: theme.palette.text.disabled }
                                  : style?.color
                                    ? { color: style.color }
                                    : {}),
                                backgroundColor: resolvedBackground,
                                ...(isSelected && {
                                  outline: `2px solid ${theme.palette.secondary.main}`,
                                  outlineOffset: -2,
                                  zIndex: 1,
                                }),
                                ...(frozenRow && {
                                  position: 'sticky',
                                  top:
                                    FORMULA_BAR_HEIGHT_PX +
                                    COLUMN_HEADER_ROW_HEIGHT_PX +
                                    rowIndex * FROZEN_ROW_HEIGHT_PX,
                                  zIndex: 2,
                                  backgroundColor: resolvedBackground,
                                }),
                                ...(frozenCol && {
                                  position: 'sticky',
                                  left: frozenColumnLeft(cellIndex),
                                  zIndex: frozenRow ? 2 : 1,
                                  backgroundColor: resolvedBackground,
                                }),
                                ...(hasFormula && {
                                  '&::after': {
                                    content: '""',
                                    position: 'absolute',
                                    top: 0,
                                    right: 0,
                                    borderStyle: 'solid',
                                    borderWidth: '0 6px 6px 0',
                                    borderColor: `transparent ${theme.palette.info.main} transparent transparent`,
                                  },
                                }),
                              };
                            }}
                          >
                            {text}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      {sheets.length > 1 && (
        <Tabs
          value={activeSheet}
          onChange={(_, value: number) => setActiveSheet(value)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={(theme) => ({
            mt: 1.5,
            minHeight: 36,
            position: 'sticky',
            bottom: 0,
            backgroundColor: theme.palette.background.paper,
            borderTop: 1,
            borderColor: 'divider',
          })}
        >
          {sheets.map((s, i) => (
            <Tab key={s.name} label={s.name} value={i} sx={{ minHeight: 36, py: 0.5 }} />
          ))}
        </Tabs>
      )}
    </Box>
  );
}
