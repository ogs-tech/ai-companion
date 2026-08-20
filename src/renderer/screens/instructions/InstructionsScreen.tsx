import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { fonts } from '../../tokens.js';
import { FolderOpen, Globe, Pencil, Plus, Trash2, WandSparkles } from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { ErrorState } from '../../components/ds/ErrorState.js';
import { Kicker } from '../../components/ds/Kicker.js';
import { LoadingState } from '../../components/ds/LoadingState.js';
import { ScreenHeader } from '../../components/ds/ScreenHeader.js';
import { CustomizationEditor, type EditorHiddenField } from '../../components/CustomizationEditor.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import type { Instruction, PersonalInstruction, ProjectInstruction } from '../../../shared/entity.js';
import { WORKSPACE_SOURCE, isPersonalInstruction, isProjectInstruction } from '../../../shared/entity.js';
import type { Settings } from '../../../shared/settings.js';
import { useInstructionsList, useInvalidateInstructions } from '../../hooks/use-instructions.js';
import { useQuery } from '@tanstack/react-query';
import { defaultGlobalInstruction } from '../../lib/default-global-instruction.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import { cursorPluginSyncPathHints } from '../../../shared/brand.js';

interface EditorState {
  entity: Instruction;
  isCreate: boolean;
}

// Personal is a singleton: name/scope are fixed AND description/version aren't
// persisted (frontmatter-free storage — see FsEntityRepository.saveInstruction),
// so hide the whole frontmatter panel to avoid a "fill me in / ignored anyway"
// trap for the user.
const PERSONAL_HIDDEN: ReadonlySet<EditorHiddenField> = new Set([
  'name',
  'scope',
  'description',
  'version',
]);
const PROJECT_HIDDEN: ReadonlySet<EditorHiddenField> = new Set(['scope']);

/**
 * Personal-instruction sync destinations grouped by assistant. Grouping lets
 * the "Synced to" panel render one chip per assistant (with the paths in a
 * hover tooltip) instead of one row per file. Cursor is included conditionally
 * by the caller when `adapters.cursor.enabled === true`.
 */
type SyncGroup = { key: string; label: string; paths: readonly string[] };

const HOME_SYNC_GROUPS: readonly SyncGroup[] = [
  { key: 'claude', label: 'Claude Code', paths: ['~/.claude/CLAUDE.md'] },
  { key: 'agents-md', label: 'AGENTS.md', paths: ['~/AGENTS.md'] },
] as const;

/** Cursor plugin materialization paths — mirrors CursorAdapter.personalInstructionDestinations. */
const HOME_CURSOR_SYNC_GROUP: SyncGroup = {
  key: 'cursor',
  label: 'Cursor',
  paths: cursorPluginSyncPathHints(),
} as const;

function basenameFromPath(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const raw = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'project';
}

function seedProjectInstruction(repoPath: string): ProjectInstruction {
  return {
    urn: '',
    kind: 'instruction',
    name: basenameFromPath(repoPath),
    description: '',
    scopes: ['project'],
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: WORKSPACE_SOURCE,
    content: `# Project instructions\n\nContext, conventions, and workflows specific to this repo.\n`,
    repoPath,
  };
}

export function InstructionsScreen(): React.ReactElement {
  const invalidate = useInvalidateInstructions();
  const { data, isLoading, isError, error } = useInstructionsList();
  const { data: settings } = useQuery<Settings | null>({
    queryKey: ['settings'],
    queryFn: () => callIpc<Settings | null>('settings.get', {}),
  });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const personal = data?.find(isPersonalInstruction) ?? null;
  const projects = (data ?? []).filter(isProjectInstruction);
  const cursorEnabled = settings?.adapters.cursor.enabled === true;

  const loadError = isError
    ? error instanceof IpcCallError ? error.message : String(error)
    : null;

  const openPersonalEdit = (): void => {
    if (personal) setEditor({ entity: personal, isCreate: false });
  };
  const openPersonalTemplate = (): void =>
    setEditor({ entity: defaultGlobalInstruction(), isCreate: true });
  const openPersonalBlank = (): void =>
    setEditor({ entity: blankCustomization('instruction') as PersonalInstruction, isCreate: true });

  const openProjectEdit = (p: ProjectInstruction): void =>
    setEditor({ entity: p, isCreate: false });

  const openProjectCreate = async (): Promise<void> => {
    setPickerError(null);
    try {
      const picked = await callIpc<{ canceled: boolean; path?: string }>('dialog.selectFolder', {});
      if (picked.canceled || !picked.path) return;
      setEditor({ entity: seedProjectInstruction(picked.path), isCreate: true });
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Erro ao abrir o seletor');
    }
  };

  const handleDelete = async (p: ProjectInstruction): Promise<void> => {
    const confirmed = window.confirm(`Remover a project instruction "${p.name}" (${p.repoPath})?`);
    if (!confirmed) return;
    try {
      await callIpc('instruction.delete', { name: p.name, removeSymlinks: true });
      await invalidate();
      setToast({ variant: 'success', message: `${p.name} removida` });
    } catch (err) {
      setToast({
        variant: 'error',
        message: err instanceof IpcCallError ? err.message : String(err),
      });
    }
  };

  if (editor) {
    const editorEntity = editor.entity;
    const isPersonal = isPersonalInstruction(editorEntity);
    return (
      <CustomizationEditor
        initial={editorEntity}
        isCreate={editor.isCreate}
        hiddenFields={isPersonal ? PERSONAL_HIDDEN : PROJECT_HIDDEN}
        titleOverride={
          isPersonal
            ? { create: 'Configurar Personal Instruction', edit: 'Editar Personal Instruction' }
            : { create: `Nova Project Instruction (${editorEntity.name})`, edit: `Editar ${editorEntity.name}` }
        }
        onSaved={async () => {
          setEditor(null);
          await invalidate();
          setToast({ variant: 'success', message: 'Instruction salva' });
        }}
        onCancel={() => setEditor(null)}
      />
    );
  }

  return (
    <Container component="main" data-testid="instructions-screen" maxWidth="md" sx={{ py: 2.5 }}>
      <ScreenHeader
        kicker="Biblioteca"
        title="Instructions"
        subtitle="Personal profile + per-project overrides, distributed to every enabled assistant"
      />

      {isLoading && <LoadingState kind="card" />}
      {loadError && <ErrorState message={`Couldn't load instructions — ${loadError}`} />}

      {!isLoading && !loadError && (
        <>
          <PersonalCard
            personal={personal}
            cursorEnabled={cursorEnabled}
            onEdit={openPersonalEdit}
            onTemplate={openPersonalTemplate}
            onBlank={openPersonalBlank}
          />

          <Paper variant="outlined" sx={{ p: 2.5, mt: 3 }}>
            <Stack
              direction="row"
              sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}
            >
              <Box>
                <Kicker>Project Instructions</Kicker>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Cada instrução é distinta e ligada a um repositório. Escolha uma pasta para criar.
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={<Icon glyph={Plus} size={16} />}
                onClick={() => void openProjectCreate()}
                data-testid="project-instruction-add"
              >
                Nova Project Instruction
              </Button>
            </Stack>

            {pickerError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {pickerError}
              </Alert>
            )}

            {projects.length === 0 ? (
              <Box
                sx={{
                  border: 1,
                  borderStyle: 'dashed',
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 3,
                  textAlign: 'center',
                  color: 'text.secondary',
                }}
              >
                <Icon glyph={FolderOpen} size={20} />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Nenhuma project instruction ainda.
                </Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {projects.map((p) => (
                  <ProjectInstructionRow
                    key={p.urn}
                    project={p}
                    cursorEnabled={cursorEnabled}
                    onEdit={() => openProjectEdit(p)}
                    onDelete={() => void handleDelete(p)}
                  />
                ))}
              </List>
            )}
          </Paper>
        </>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Container>
  );
}

interface PersonalCardProps {
  personal: PersonalInstruction | null;
  cursorEnabled: boolean;
  onEdit: () => void;
  onTemplate: () => void;
  onBlank: () => void;
}

function PersonalCard({ personal, cursorEnabled, onEdit, onTemplate, onBlank }: PersonalCardProps): React.ReactElement {
  const groups: readonly SyncGroup[] = [
    ...HOME_SYNC_GROUPS,
    ...(cursorEnabled ? [HOME_CURSOR_SYNC_GROUP] : []),
  ];

  return (
    <Paper variant="outlined" data-testid="personal-instruction-card" sx={{ p: 2.5 }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <Box>
          <Kicker>Personal Instruction</Kicker>
          <Typography variant="h6" component="h2" sx={{ mt: 0.5 }}>
            {personal ? 'Seu perfil global' : 'Configure suas Personal Instructions'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520, mt: 0.5 }}>
            {personal
              ? personal.description ||
                'Distribuídas para cada assistente habilitado (Claude Code, Cursor via plugin).'
              : 'Um perfil único aplicado a todos os assistentes habilitados. Comece com o template padrão ou do zero.'}
          </Typography>
        </Box>
        {personal ? (
          <Chip
            label="Configurado"
            color="success"
            size="small"
            icon={<Icon glyph={Globe} size={16} />}
          />
        ) : null}
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
        {personal ? (
          <Button
            variant="outlined"
            startIcon={<Icon glyph={Pencil} size={16} />}
            onClick={onEdit}
            data-testid="personal-instruction-edit"
          >
            Editar
          </Button>
        ) : (
          <>
            <Button
              variant="contained"
              startIcon={<Icon glyph={WandSparkles} size={16} />}
              onClick={onTemplate}
              data-testid="personal-instruction-use-template"
            >
              Usar template padrão
            </Button>
            <Button
              variant="text"
              onClick={onBlank}
              data-testid="personal-instruction-start-blank"
            >
              Começar do zero
            </Button>
          </>
        )}
      </Stack>

      <Divider sx={{ my: 2 }} />
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
        data-testid="personal-instruction-synced-to"
      >
        <Kicker>Synced to</Kicker>
        {groups.map((g) => (
          <SyncGroupChip key={g.key} group={g} />
        ))}
      </Stack>
    </Paper>
  );
}

interface SyncGroupChipProps {
  group: SyncGroup;
}

/**
 * Renders one assistant as a compact chip. The concatenated paths live in the
 * chip's `aria-label` (always in the DOM — testable, screen-reader friendly)
 * AND in a hover Tooltip (opt-in visual for sighted users). We deliberately
 * keep the label short (`Cursor · 2`) so the row fits on one line even when
 * every adapter is enabled.
 */
function SyncGroupChip({ group }: SyncGroupChipProps): React.ReactElement {
  const label = group.paths.length > 1 ? `${group.label} · ${group.paths.length}` : group.label;
  const accessiblePaths = group.paths.join(', ');
  return (
    <Tooltip
      title={
        <Box sx={{ fontFamily: fonts.mono, fontSize: '0.72rem', whiteSpace: 'pre-line' }}>
          {group.paths.join('\n')}
        </Box>
      }
      arrow
      placement="top"
    >
      <Chip
        size="small"
        variant="outlined"
        label={label}
        data-testid={`sync-chip-${group.key}`}
        aria-label={`${group.label}: ${accessiblePaths}`}
      />
    </Tooltip>
  );
}

interface ProjectRowProps {
  project: ProjectInstruction;
  cursorEnabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function ProjectInstructionRow({ project, cursorEnabled, onEdit, onDelete }: ProjectRowProps): React.ReactElement {
  const destCount = 2 + (cursorEnabled ? 1 : 0); // .claude/CLAUDE.md, AGENTS.md (+cursor AGENTS.md on top)
  return (
    <ListItem
      data-testid="project-instruction-row"
      divider
      secondaryAction={
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Editar">
            <IconButton edge="end" onClick={onEdit} aria-label="Editar" data-testid="project-instruction-edit">
              <Icon glyph={Pencil} size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Remover">
            <IconButton edge="end" onClick={onDelete} aria-label="Remover" data-testid="project-instruction-delete">
              <Icon glyph={Trash2} size={16} />
            </IconButton>
          </Tooltip>
        </Stack>
      }
    >
      <ListItemText
        primary={<Box component="strong">{project.name}</Box>}
        secondary={
          <>
            <Box component="code" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
              {project.repoPath}
            </Box>
            {' — '}
            {destCount} destino{destCount === 1 ? '' : 's'}
          </>
        }
      />
    </ListItem>
  );
}
