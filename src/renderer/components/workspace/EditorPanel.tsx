import { useEffect, useEffectEvent, useState } from 'react';
import { Alert, Box, Collapse, ListItemButton, Stack } from '@mui/material';
import { ChevronDown, ChevronRight, FileX } from 'lucide-react';
import { Kicker } from '../ds/Kicker.js';
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
import { entityBody, withEntityBody } from '../../lib/entity-body.js';
import { useFilePreview, useWriteFile } from '../../hooks/use-file-browser.js';
import { languageForPath } from '../../lib/code-language.js';

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
  const [propertiesOpen, setPropertiesOpen] = useState(isCreate);

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

      {showFrontmatter && (
        <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
          <ListItemButton
            dense
            onClick={() => setPropertiesOpen((v) => !v)}
            data-testid="editor-properties-toggle"
            sx={{ px: 2, py: 0.75 }}
          >
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexGrow: 1 }}>
              <Icon glyph={propertiesOpen ? ChevronDown : ChevronRight} size={14} />
              <Kicker>Properties</Kicker>
            </Stack>
          </ListItemButton>
          <Collapse in={propertiesOpen} unmountOnExit>
            <Box sx={{ px: 2, pb: 2 }}>
              <PropertiesForm entity={entity} onChange={setEntity} {...(hiddenFields ? { hiddenFields } : {})} readOnly={readOnly} />
            </Box>
          </Collapse>
        </Box>
      )}

      <Box sx={{ px: 2, py: 2 }}>
        <MarkdownBody mode={readOnly ? 'preview' : 'edit'} body={body} onChangeBody={setBody} disabled={readOnly} language="markdown" />
      </Box>

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

  // Seed the draft once, the first time a previewable file's content arrives
  // — an in-render adjustment (not an effect) guarded by `draft === null`,
  // so it fires exactly once and converges: after the first `setDraft` call
  // the guard is false on every later render, so a background refetch (e.g.
  // the cache update after this tab's own save) never clobbers in-progress
  // edits.
  if (preview?.previewable && draft === null) {
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
  // silently discard its untruncated tail.
  const editable = preview?.previewable === true && preview.truncated === false;

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
  return <MarkdownBody mode="preview" body={preview.content} onChangeBody={() => {}} disabled language="markdown" />;
}
