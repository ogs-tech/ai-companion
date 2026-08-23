import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Alert, Box, Button, Checkbox, CircularProgress, Container, FormControlLabel,
  FormGroup, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { WandSparkles } from 'lucide-react';
import { Kicker } from './ds/Kicker.js';
import { Icon } from './ds/Icon.js';
import { fonts } from '../tokens.js';
import { callIpc, IpcCallError } from '../lib/ipc.js';
import { Toast, type ToastMessage } from './Toast.js';
import { SyncReportModal } from './SyncReportModal.js';
import { SessionPanel, SessionPanelLocked } from './SessionPanel.js';
import type { Agent, Instruction, Scope, Skill } from '../../shared/entity.js';
import { entityUrn } from '../../shared/entity.js';
import type { SyncResult } from '../../shared/sync-result.js';
import { entityBody, withEntityBody } from '../lib/entity-body.js';
import type { GenerateDraftPhase } from '../../shared/instruction-generation.js';

const GENERATE_PHASE_LABEL: Record<GenerateDraftPhase, string> = {
  starting: 'Iniciando sessão…',
  requesting: 'Consultando o modelo…',
  writing: 'Escrevendo…',
  done: 'Concluído',
};

type EditableEntity = Skill | Agent | Instruction;

const SAVE_BY_KIND: Record<EditableEntity['kind'], { method: string; payloadKey: string; resultKey: string }> = {
  skill: { method: 'skill.save', payloadKey: 'skill', resultKey: 'skill' },
  agent: { method: 'agent.save', payloadKey: 'agent', resultKey: 'agent' },
  instruction: { method: 'instruction.save', payloadKey: 'instruction', resultKey: 'instruction' },
};

// TODO(follow-up): reintroduce 'project' for skill/agent once each carries its
// own repoPath (mirroring ProjectInstruction). Blocked at the schema level
// today after settings.linkedRepos was removed.
const scopeOptionsFor = (kind: EditableEntity['kind']): readonly Scope[] =>
  kind === 'instruction' ? (['personal', 'project'] as const) : (['personal'] as const);

export type EditorHiddenField = 'name' | 'scope' | 'description' | 'version';

interface CustomizationEditorProps {
  initial: EditableEntity;
  isCreate: boolean;
  onSaved: (saved: EditableEntity) => void | Promise<void>;
  onCancel: () => void;
  /**
   * Fields the parent screen doesn't want the user to see. Instructions use
   * this heavily: the personal singleton hides `name` and `scope` (they're
   * fixed at `default` / `personal`), and both instruction kinds may hide
   * description/version depending on the screen's info density.
   */
  hiddenFields?: ReadonlySet<EditorHiddenField>;
  /**
   * Optional heading override used by the instruction screens ("Editar
   * instrução pessoal", "Editar acme"). Defaults to the generic
   * "Nova customização" / "Editar <name>".
   */
  titleOverride?: { create: string; edit: string };
  /**
   * Personal Instruction only: shows a "Gerar com IA" action that streams a
   * draft from the user's local `claude` CLI straight into the body field.
   */
  enableGenerate?: boolean;
}

type BodyView = 'edit' | 'preview' | 'split';

export function CustomizationEditor({
  initial,
  isCreate,
  onSaved,
  onCancel,
  hiddenFields,
  titleOverride,
  enableGenerate,
}: CustomizationEditorProps): React.ReactElement {
  const [entity, setEntity] = useState<EditableEntity>(initial);
  const [body, setBody] = useState(entityBody(initial));
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncReport, setSyncReport] = useState<SyncResult[]>([]);
  const [bodyView, setBodyView] = useState<BodyView>('split');

  const [generatePanelOpen, setGeneratePanelOpen] = useState(false);
  const [generateContext, setGenerateContext] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatePhase, setGeneratePhase] = useState<GenerateDraftPhase | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const handleGenerate = async (): Promise<void> => {
    setGenerateError(null);
    setGenerating(true);
    setGeneratePhase('starting');
    setBody('');

    const unsubscribe = window.api.onInstructionGenerateProgress((event) => {
      setGeneratePhase(event.phase);
      if (event.textDelta) setBody((prev) => prev + event.textDelta);
    });

    try {
      const trimmed = generateContext.trim();
      const result = await callIpc<{ content: string }>('instruction.generateDraft', {
        ...(trimmed ? { context: trimmed } : {}),
      });
      setBody(result.content);
      setGeneratePanelOpen(false);
      setGenerateContext('');
    } catch (err) {
      setGenerateError(err instanceof IpcCallError ? err.message : String(err));
    } finally {
      unsubscribe();
      setGenerating(false);
      setGeneratePhase(null);
    }
  };

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

  const isHidden = (field: EditorHiddenField): boolean => hiddenFields?.has(field) ?? false;
  const title = titleOverride
    ? (isCreate ? titleOverride.create : titleOverride.edit)
    : (isCreate ? 'Nova customização' : `Editar ${initial.name}`);
  const showFrontmatter =
    !isHidden('name') || !isHidden('description') || !isHidden('version') || !isHidden('scope');

  return (
    <Container component="main" data-testid="customization-editor" maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 3, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={onCancel} disabled={generating}>Cancelar</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || generating}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </Stack>
      </Stack>

      {showFrontmatter && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
          <Box sx={{ mb: 2 }}><Kicker>Frontmatter</Kicker></Box>
          <Stack spacing={2}>
            {!isHidden('name') && (
              <TextField
                label="Name"
                value={entity.name}
                onChange={(e) => setEntity((prev) => ({ ...prev, name: e.target.value } as EditableEntity))}
                slotProps={{ htmlInput: { pattern: '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$', title: 'lowercase letters, digits and hyphens only (1-64 chars, no leading/trailing hyphen)' } }}
                fullWidth
              />
            )}
            {!isHidden('description') && (
              <TextField
                label="Description"
                value={entity.description}
                onChange={(e) => setEntity((prev) => ({ ...prev, description: e.target.value }))}
                slotProps={{ htmlInput: { maxLength: 200 } }}
                helperText={`${entity.description.length}/200`}
                fullWidth
              />
            )}
            {!isHidden('version') && (
              <TextField
                label="Version"
                value={entity.metadata.version}
                onChange={(e) => setEntity((prev) => ({ ...prev, metadata: { ...prev.metadata, version: e.target.value } }))}
                sx={{ maxWidth: 200 }}
              />
            )}
            {!isHidden('scope') && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Scope</Typography>
                <FormGroup row>
                  {(scopeOptionsFor(entity.kind)).map((value) => (
                    <FormControlLabel
                      key={value}
                      control={
                        <Checkbox
                          checked={(entity.scopes as Scope[]).includes(value)}
                          onChange={(e) => {
                            const scopesArr = entity.scopes as Scope[];
                            const next: Scope[] = e.target.checked
                              ? Array.from(new Set([...scopesArr, value]))
                              : scopesArr.filter((s) => s !== value);
                            setEntity((prev) => ({ ...prev, scopes: next } as unknown as EditableEntity));
                          }}
                        />
                      }
                      label={value}
                    />
                  ))}
                </FormGroup>
              </Box>
            )}
          </Stack>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Kicker>Body</Kicker>
            {enableGenerate && !generatePanelOpen && !generating && (
              <Button
                size="small"
                variant="text"
                startIcon={<Icon glyph={WandSparkles} size={14} />}
                onClick={() => setGeneratePanelOpen(true)}
                data-testid="editor-generate-open"
              >
                Gerar com IA
              </Button>
            )}
          </Stack>
          <ToggleButtonGroup size="small" exclusive value={bodyView} onChange={(_, v: BodyView | null) => v && setBodyView(v)}>
            <ToggleButton value="edit">Editar</ToggleButton>
            <ToggleButton value="split">Dividir</ToggleButton>
            <ToggleButton value="preview">Prévia</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        {enableGenerate && generatePanelOpen && !generating && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Contexto opcional — como você gosta de trabalhar, preferências, regras de segurança…"
              value={generateContext}
              onChange={(e) => setGenerateContext(e.target.value)}
              slotProps={{ htmlInput: { 'data-testid': 'editor-generate-context' } }}
            />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={() => void handleGenerate()} data-testid="editor-generate-submit">
                Gerar
              </Button>
              <Button
                variant="text"
                onClick={() => { setGeneratePanelOpen(false); setGenerateContext(''); }}
              >
                Cancelar
              </Button>
            </Stack>
          </Stack>
        )}

        {generateError && (
          <Alert severity="error" role="alert" data-testid="editor-generate-error" sx={{ mb: 2 }}>
            {generateError}
          </Alert>
        )}

        {generating && (
          <Box
            data-testid="editor-generate-phase"
            sx={(theme) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              alignSelf: 'flex-start',
              px: 1,
              py: 0.25,
              mb: 2,
              borderRadius: theme.ogs.radius.pill,
              border: `1px solid ${theme.palette.info.main}`,
              color: theme.palette.info.main,
            })}
          >
            <Box
              component="span"
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: 'currentColor',
                animation: 'editorGeneratePulse 1.4s ease-in-out infinite',
                '@keyframes editorGeneratePulse': { '0%, 100%': { opacity: 0.35 }, '50%': { opacity: 1 } },
              }}
            />
            <Typography
              component="span"
              sx={(theme) => ({
                fontFamily: theme.ogs.fonts.mono,
                fontSize: '0.6875rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              })}
            >
              {generatePhase ? GENERATE_PHASE_LABEL[generatePhase] : ''}
            </Typography>
          </Box>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: bodyView === 'split' ? '1fr 1fr' : '1fr', gap: 2 }}>
          {(bodyView === 'edit' || bodyView === 'split') && (
            <TextField
              value={body}
              onChange={(e) => setBody(e.target.value)}
              multiline minRows={16} fullWidth
              disabled={generating}
              slotProps={{ htmlInput: { 'data-testid': 'body-textarea', style: { fontFamily: fonts.mono, fontSize: '0.9rem', lineHeight: 1.5 } } }}
            />
          )}
          {(bodyView === 'preview' || bodyView === 'split') && (
            <Box
              data-testid="markdown-preview"
              sx={{
                border: 1, borderColor: 'divider', borderRadius: 1, p: 2, minHeight: 240,
                bgcolor: 'background.default', overflow: 'auto',
                '& h1, & h2, & h3': { mt: 1.5, mb: 1 }, '& p': { my: 1 },
                '& code': { bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5, fontFamily: 'monospace' },
                '& pre': { bgcolor: 'action.hover', p: 1.5, borderRadius: 1, overflow: 'auto' },
              }}
            >
              <ReactMarkdown>{body}</ReactMarkdown>
            </Box>
          )}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
        {!isCreate && initial.urn ? <SessionPanel anchor={{ kind: 'entity', urn: initial.urn }} /> : <SessionPanelLocked />}
      </Paper>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <SyncReportModal report={syncReport} onClose={() => setSyncReport([])} />
    </Container>
  );
}
