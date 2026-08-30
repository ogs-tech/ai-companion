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
  TableRow,
  Tabs,
} from '@mui/material';
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
import type { SpreadsheetCell, SpreadsheetCellStyle, SpreadsheetMerge, SpreadsheetSheet } from '../../../shared/file-browser.js';
import { entityBody, withEntityBody } from '../../lib/entity-body.js';
import { useFilePreview, useWriteFile } from '../../hooks/use-file-browser.js';
import { languageForPath } from '../../lib/code-language.js';
import { fonts } from '../../tokens.js';

export type { EditableEntity, EditorHiddenField };

export type PreviewSource = { kind: 'file'; path: string; projectId?: string } | { kind: 'entity'; body: string };

const SAVE_BY_KIND: Record<EditableEntity['kind'], { method: string; payloadKey: string; resultKey: string }> = {
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

  const [baseline, setBaseline] = useState(() => ({ props: propertiesSnapshot(initial), body: entityBody(initial) }));
  const isDirty = !readOnly && (propertiesSnapshot(entity) !== baseline.props || body !== baseline.body);
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
      const result = await callIpc<Record<string, unknown>>(method, { [payloadKey]: toSave, isCreate });
      const saved = result[resultKey] as EditableEntity;
      const report = (result['syncReport'] as SyncResult[] | undefined) ?? [];

      setEntity(saved);
      setBody(entityBody(saved));
      setBaseline({ props: propertiesSnapshot(saved), body: entityBody(saved) });

      setToast({ variant: 'success', message: `${saved.name} salvo` });
      if (report.some((entry) => entry.status !== 'ok')) setSyncReport(report);
      await onSaved(saved);
    } catch (err) {
      if (err instanceof IpcCallError && err.kind === 'validation' && Array.isArray(err.details?.errors)) {
        const errors = err.details.errors as Array<{ path: string; message: string }>;
        const list = errors.map((e) => `${e.path}: ${e.message}`).join('\n');
        setToast({ variant: 'error', message: `${errors.length} validation error(s)\n${list}` });
      } else {
        setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
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
    <Box data-testid="editor-panel" sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      {readOnly && pluginSource && (
        <Box sx={{ px: 2, pt: 2, flexShrink: 0 }}>
          <ReadOnlyNotice pluginId={pluginSource.pluginId} />
        </Box>
      )}

      <Box sx={{ px: 2, py: 2 }}>
        <MarkdownBody mode={readOnly ? 'preview' : 'edit'} body={body} onChangeBody={setBody} disabled={readOnly} language="markdown" />
      </Box>

      {showFrontmatter && (
        <Dialog open={propertiesOpen} onClose={() => setPropertiesOpen(false)} maxWidth="sm" fullWidth data-testid="properties-modal">
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            Properties
            <IconButton size="small" aria-label="Fechar" onClick={() => setPropertiesOpen(false)}>
              <Icon glyph={X} size={16} />
            </IconButton>
          </DialogTitle>
          <DialogContent>
            <PropertiesForm entity={entity} onChange={setEntity} {...(hiddenFields ? { hiddenFields } : {})} readOnly={readOnly} />
          </DialogContent>
        </Dialog>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <SyncReportModal report={syncReport} onClose={() => setSyncReport([])} />
    </Box>
  );
}

type FileSubjectProps = Extract<EditorPanelProps, { subject: 'file' }>;

function FileSubject({ path, projectId, active = true, onDirtyChange }: FileSubjectProps): React.ReactElement {
  const { data: preview, isLoading, isError, error } = useFilePreview(path, { ...(projectId ? { projectId } : {}) });
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
  const editable = preview?.previewable === true && preview.kind === 'text' && preview.truncated === false;

  const handleSave = async (): Promise<void> => {
    if (draft === null) return;
    setSaving(true);
    try {
      await writeFile.mutateAsync({ path, content: draft, ...(projectId ? { projectId } : {}) });
      setBaseline(draft);
      setToast({ variant: 'success', message: `${fileTitle(path)} salvo` });
    } catch (err) {
      setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
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
        <EmptyState glyph={FileX} title="Não é possível pré-visualizar" description={preview.reason} testId="file-preview-reason" />
      </Box>
    );
  } else if (preview.kind === 'spreadsheet') {
    body = <SpreadsheetPreview sheets={preview.sheets} truncated={preview.truncated} />;
  } else if (draft === null) {
    body = <Box data-testid="file-preview-loading" />;
  } else {
    const truncatedNotice = preview.truncated && (
      <Alert severity="info" data-testid="file-preview-truncated-notice" sx={{ mb: 1.5 }}>
        Arquivo grande — mostrando apenas o início. Edição desabilitada para não gravar um arquivo incompleto.
      </Alert>
    );
    body = (
      <>
        {truncatedNotice}
        <MarkdownBody mode="edit" body={draft} onChangeBody={setDraft} disabled={!editable} language={languageForPath(path)} />
      </>
    );
  }

  return (
    <Box data-testid="editor-panel" sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
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
        <MarkdownBody mode="preview" body={source.body} onChangeBody={() => {}} disabled language="markdown" />
      ) : (
        <FilePreviewBody path={source.path} {...(source.projectId ? { projectId: source.projectId } : {})} />
      )}
    </Box>
  );
}

function FilePreviewBody({ path, projectId }: { path: string; projectId?: string }): React.ReactElement {
  const { data: preview, isLoading, isError, error } = useFilePreview(path, { ...(projectId ? { projectId } : {}) });

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
        <EmptyState glyph={FileX} title="Não é possível pré-visualizar" description={preview.reason} testId="file-preview-reason" />
      </Box>
    );
  }
  if (preview.kind === 'spreadsheet') return <SpreadsheetPreview sheets={preview.sheets} truncated={preview.truncated} />;
  return <MarkdownBody mode="preview" body={preview.content} onChangeBody={() => {}} disabled language="markdown" />;
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

/** Excel's column width is "characters of the default font" — the same character-to-pixel approximation spreadsheet tooling commonly uses to translate it into a CSS width. */
function columnWidthPx(width: number | undefined): number | undefined {
  return width === undefined ? undefined : Math.round(width * 7 + 5);
}

/** Nominal row height for a dense (`size="small"`) table row under this grid's single-line cell styling — used only to stack a multi-row frozen header's sticky offsets; it doesn't affect the cells' own layout. */
const FROZEN_ROW_HEIGHT_PX = 33;

/** From a sheet's merge list: which cell positions a merge covers besides its own top-left anchor (skipped on render, since the anchor's colSpan/rowSpan already accounts for them), keyed by the anchor position for the ones that need those span attributes. */
function buildMergeIndex(merges: SpreadsheetMerge[]): { anchors: Map<string, SpreadsheetMerge>; covered: Set<string> } {
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

/**
 * A read-only grid for a parsed `.xlsx` workbook. Sheet tabs sit at the
 * bottom of the grid — where native spreadsheet apps (Excel, Google Sheets,
 * LibreOffice) put them — and scroll horizontally when there are more
 * sheets than fit. A merged range renders as one cell with the matching
 * colSpan/rowSpan; a cell's own font/fill/alignment from the source file
 * wins over this grid's built-in heuristics (first-column emphasis, numeric
 * right-align), which only kick in for a cell the file left unstyled. A
 * frozen header row, when the sheet has one, stays pinned while the body
 * scrolls. Each cell is width-capped with a single-line ellipsis (full
 * value available via the native `title` tooltip on hover) — without that
 * cap, a long free-text cell (a legend, a note) forces its row to wrap
 * across many lines while every other row in the sheet stays single-line,
 * which is what broke the layout: rows lose a consistent height and columns
 * drift out of alignment with the header above them. No cell editing yet:
 * the main-process side only reads spreadsheets, it doesn't write them back.
 */
function SpreadsheetPreview({ sheets, truncated }: { sheets: SpreadsheetSheet[]; truncated: boolean }): React.ReactElement {
  const [activeSheet, setActiveSheet] = useState(0);
  const sheet = sheets[activeSheet] ?? sheets[0];
  const { anchors, covered } = buildMergeIndex(sheet?.merges ?? []);

  return (
    <Box data-testid="spreadsheet-preview">
      {truncated && (
        <Alert severity="info" data-testid="spreadsheet-truncated-notice" sx={{ mb: 1.5 }}>
          Planilha grande — mostrando apenas as primeiras linhas de cada aba.
        </Alert>
      )}
      {!sheet || sheet.rows.length === 0 ? (
        <EmptyState glyph={FileX} title="Aba vazia" description="Esta planilha não tem linhas para mostrar." testId="spreadsheet-empty" />
      ) : (
        <TableContainer component={Paper}>
          <Table size="small" sx={{ borderCollapse: 'collapse' }}>
            <TableBody>
              {sheet.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex} sx={(theme) => ({ '&:nth-of-type(even)': { backgroundColor: theme.palette.action.hover } })}>
                  {row.map((cell, cellIndex) => {
                    if (covered.has(`${rowIndex}:${cellIndex}`)) return null;
                    const merge = anchors.get(`${rowIndex}:${cellIndex}`);
                    const text = cellText(cell);
                    const style = cellStyle(cell);
                    const isLabelColumn = cellIndex === 0;
                    const numeric = isNumericCell(text);
                    const align = style?.align ?? (numeric ? 'right' : 'left');
                    const bold = style ? (style.bold ?? false) : isLabelColumn;
                    const widthPx = columnWidthPx(sheet.columnWidths[cellIndex]);
                    const frozenRow = rowIndex < sheet.frozenRows;
                    return (
                      <TableCell
                        key={cellIndex}
                        title={text}
                        colSpan={merge?.colSpan ?? 1}
                        rowSpan={merge?.rowSpan ?? 1}
                        sx={(theme) => {
                          const backgroundColor = style ? style.backgroundColor : isLabelColumn ? theme.ogs.surfaces.rail : undefined;
                          return {
                            fontFamily: fonts.mono,
                            fontSize: '0.8125rem',
                            lineHeight: 1.5,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            width: widthPx,
                            maxWidth: widthPx ?? (isLabelColumn ? 420 : 280),
                            minWidth: widthPx ?? (isLabelColumn ? 160 : 90),
                            border: 1,
                            borderColor: 'divider',
                            textAlign: align,
                            fontWeight: bold ? 600 : 400,
                            fontStyle: style?.italic ? 'italic' : 'normal',
                            ...(style?.color ? { color: style.color } : {}),
                            ...(backgroundColor ? { backgroundColor } : {}),
                            ...(frozenRow && {
                              position: 'sticky',
                              top: rowIndex * FROZEN_ROW_HEIGHT_PX,
                              zIndex: 2,
                              backgroundColor: backgroundColor ?? theme.palette.background.paper,
                            }),
                          };
                        }}
                      >
                        {text}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
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
