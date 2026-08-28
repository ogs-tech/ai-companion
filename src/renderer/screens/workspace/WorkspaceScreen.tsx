import { useState } from 'react';
import { Box, Button, Container, Dialog, Divider, IconButton, List, Paper, Tooltip } from '@mui/material';
import { Eye, EyeOff, File as FileIcon, FileX, PanelRight, SquareTerminal, Trash2 } from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { ScreenHeader } from '../../components/ds/ScreenHeader.js';
import { EmptyState } from '../../components/ds/EmptyState.js';
import { Kicker } from '../../components/ds/Kicker.js';
import { FolderTree } from '../../components/workspace/FolderTree.js';
import { FilePreviewPane } from '../../components/workspace/FilePreviewPane.js';
import { WorkspaceManagementList } from '../../components/workspace/WorkspaceManagementList.js';
import { InstructionTreeRow } from '../../components/workspace/InstructionTreeRow.js';
import { EntityTreeGroup } from '../../components/workspace/EntityTreeGroup.js';
import { HooksTreeGroup } from '../../components/workspace/HooksTreeGroup.js';
import { McpTreeGroup } from '../../components/workspace/McpTreeGroup.js';
import { PluginsTreeGroup } from '../../components/workspace/PluginsTreeGroup.js';
import { SessionsTreeGroup } from '../../components/workspace/SessionsTreeGroup.js';
import { WorkbenchCanvas, type WorkbenchTab } from '../../components/workspace/WorkbenchCanvas.js';
import { CustomizationEditor, type EditorHiddenField } from '../../components/CustomizationEditor.js';
import { WorkspaceRemoveConfirmDialog } from '../../components/shell/WorkspaceRemoveConfirmDialog.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import { seedProjectInstruction, seedWorkspaceInstruction } from '../../lib/instruction-seed.js';
import { useSessionFocus } from '../../lib/session-focus-context.js';
import { useActiveWorkspace, useDeleteWorkspace, useSwitchWorkspace } from '../../hooks/use-workspaces.js';
import { useDeleteProject, useFindOrCreateProjectByPath, useProjects } from '../../hooks/use-projects.js';
import { useInvalidateCustomization } from '../../hooks/use-customization-list.js';
import {
  useInvalidateInstructions,
  usePersonalInstruction,
  useProjectInstruction,
  useWorkspaceInstruction,
} from '../../hooks/use-instructions.js';
import { isPersonalInstruction } from '../../../shared/entity.js';
import type { Agent, Instruction, Skill } from '../../../shared/entity.js';
import type { Workspace } from '../../../shared/workspace.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const PERSONAL_HIDDEN: ReadonlySet<EditorHiddenField> = new Set(['name', 'scope', 'description', 'version']);
const SCOPED_HIDDEN: ReadonlySet<EditorHiddenField> = new Set(['scope']);

interface FileTab {
  id: string;
  relPath: string;
}

type EntityDialogState =
  | { kind: 'skill' | 'agent'; entity: Skill | Agent; isCreate: boolean }
  | { kind: 'instruction'; entity: Instruction; isCreate: boolean };

/**
 * Skill/Agent/Instruction editing lives in a dialog, the same pattern MCP
 * already uses (McpEditorDialog) — the Workbench canvas is file-only, so a
 * Customization editing itself never competes with an open file for that
 * space, and never gets squeezed into the 280px tree column either.
 */
function EntityEditorDialog({
  state,
  onClose,
  onSaved,
  onToast,
}: {
  state: EntityDialogState | null;
  onClose: () => void;
  onSaved: (saved: Skill | Agent | Instruction) => void;
  onToast: (toast: ToastMessage) => void;
}): React.ReactElement {
  const invalidateCustomization = useInvalidateCustomization();
  const invalidateInstructions = useInvalidateInstructions();

  return (
    <Dialog open={state !== null} onClose={onClose} fullScreen data-testid="entity-editor-dialog">
      {state &&
        (() => {
          const isPersonal = state.kind === 'instruction' && isPersonalInstruction(state.entity);
          return (
            <CustomizationEditor
              initial={state.entity}
              isCreate={state.isCreate}
              {...(state.kind === 'instruction'
                ? {
                    hiddenFields: isPersonal ? PERSONAL_HIDDEN : SCOPED_HIDDEN,
                    enableGenerate: isPersonal,
                    titleOverride: isPersonal
                      ? { create: 'Configurar Personal Instruction', edit: 'Editar Personal Instruction' }
                      : { create: `Nova instruction (${state.entity.name})`, edit: `Editar ${state.entity.name}` },
                  }
                : {})}
              onSaved={async (saved) => {
                onSaved(saved);
                if (state.kind === 'instruction') {
                  await invalidateInstructions();
                  onToast({ variant: 'success', message: 'Instruction salva' });
                } else {
                  await invalidateCustomization(state.kind);
                  onToast({ variant: 'success', message: `${saved.name} salvo` });
                }
              }}
              onCancel={onClose}
            />
          );
        })()}
    </Dialog>
  );
}

export function WorkspaceScreen(): React.ReactElement {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: projects = [] } = useProjects();
  const { data: personalInstruction } = usePersonalInstruction();
  const findOrCreateProject = useFindOrCreateProjectByPath();
  const deleteProject = useDeleteProject();
  const switchWorkspace = useSwitchWorkspace();
  const deleteWorkspace = useDeleteWorkspace();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { focusSession } = useSessionFocus();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // Hidden by default inside a project workspace, to keep the tree focused on
  // what's actually local to it — plugin-provided and Personal-scope entities
  // are already visible everywhere else, so they're the ones worth hiding.
  const [showGlobal, setShowGlobal] = useState(false);
  // Independent from showGlobal — it filters by session status (running vs. exited), not local/global scope.
  const [showFinishedSessions, setShowFinishedSessions] = useState(false);
  // Captured when the dialog opens, not read live off `activeWorkspace` — see SubRail's old WorkspaceContext, which this replaces.
  const [pendingRemoval, setPendingRemoval] = useState<Workspace | null>(null);

  // Every open file is a Workbench canvas tab. Skills/Agents/Instructions
  // open in entityDialog instead — the canvas stays file-only.
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [entityDialog, setEntityDialog] = useState<EntityDialogState | null>(null);
  // The file browser is a togglable side panel next to the canvas, not a
  // fixed column — Sessões/Customizations own the primary rail instead.
  const [showFiles, setShowFiles] = useState(true);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const { data: workspaceInstruction } = useWorkspaceInstruction(activeWorkspace?.id ?? '');
  const { data: projectInstruction } = useProjectInstruction(selectedProject?.id ?? '');

  const openFileTab = (relPath: string): void => {
    const id = `file:${relPath}`;
    setFileTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, relPath }]));
    setActiveTabId(id);
  };

  const closeFileTab = (id: string): void => {
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((cur) => (cur === id ? (next[next.length - 1]?.id ?? null) : cur));
      return next;
    });
  };

  const resetTabs = (): void => {
    setFileTabs([]);
    setActiveTabId(null);
  };

  const openEntityDialog = (kind: 'skill' | 'agent', entity: Skill | Agent, isCreate: boolean): void =>
    setEntityDialog({ kind, entity, isCreate });

  const openInstructionEditor = (entity: Instruction, isCreate: boolean): void =>
    setEntityDialog({ kind: 'instruction', entity, isCreate });

  const instructionRow = !activeWorkspace ? undefined : selectedProject ? (
    <InstructionTreeRow
      kind="project"
      instruction={projectInstruction}
      seed={() => seedProjectInstruction(selectedProject)}
      onOpen={openInstructionEditor}
    />
  ) : (
    <InstructionTreeRow
      kind="workspace"
      instruction={workspaceInstruction}
      seed={() => seedWorkspaceInstruction(activeWorkspace)}
      onOpen={openInstructionEditor}
    />
  );

  // Skills/Agents are scoped to whichever node is currently in view (a
  // selected Project, or the active workspace itself); Hooks have no
  // project/workspace tier of their own yet, and MCP's own local tier
  // ('project-local'/'project-shared') keys off a filesystem path instead.
  const entityLocalScope = selectedProject
    ? { scope: 'project' as const, scopeId: selectedProject.id }
    : activeWorkspace
      ? { scope: 'workspace' as const, scopeId: activeWorkspace.id }
      : undefined;
  const mcpMatchPath = selectedProject ? selectedProject.path : activeWorkspace?.rootPath;

  const customizationRows = (
    <>
      {instructionRow}
      <EntityTreeGroup kind="skill" label="Skills" showGlobal={showGlobal} onEdit={openEntityDialog} {...(entityLocalScope ? { localScope: entityLocalScope } : {})} />
      <EntityTreeGroup kind="agent" label="Agents" showGlobal={showGlobal} onEdit={openEntityDialog} {...(entityLocalScope ? { localScope: entityLocalScope } : {})} />
      <HooksTreeGroup isProjectContext showGlobal={showGlobal} />
      <McpTreeGroup showGlobal={showGlobal} {...(mcpMatchPath ? { matchPath: mcpMatchPath } : {})} />
      <PluginsTreeGroup isProjectContext showGlobal={showGlobal} />
    </>
  );

  const finishedSessionsToggle = (
    <Tooltip title={showFinishedSessions ? 'Ocultar sessões finalizadas' : 'Mostrar sessões finalizadas'}>
      <Button
        variant="outlined"
        size="small"
        startIcon={<Icon glyph={showFinishedSessions ? EyeOff : Eye} size={16} />}
        data-testid="workspace-toggle-finished-sessions"
        onClick={() => setShowFinishedSessions((v) => !v)}
      >
        {showFinishedSessions ? 'Ocultar finalizadas' : 'Mostrar finalizadas'}
      </Button>
    </Tooltip>
  );

  const filesToggle = (
    <Tooltip title={showFiles ? 'Ocultar arquivos' : 'Mostrar arquivos'}>
      <Button
        variant="outlined"
        size="small"
        startIcon={<Icon glyph={PanelRight} size={16} />}
        data-testid="workspace-toggle-files"
        onClick={() => setShowFiles((v) => !v)}
      >
        {showFiles ? 'Ocultar arquivos' : 'Arquivos'}
      </Button>
    </Tooltip>
  );

  const selectProject = (id: string): void => {
    setSelectedProjectId(id);
    resetTabs();
  };

  const exitProjectScope = (): void => {
    setSelectedProjectId(null);
    resetTabs();
  };

  const handleDeleteProject = async (id: string): Promise<void> => {
    try {
      await deleteProject.mutateAsync(id);
      exitProjectScope();
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const handleUseAsProject = async (absolutePath: string): Promise<void> => {
    try {
      await findOrCreateProject.mutateAsync(absolutePath);
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const handleNavigateHome = async (): Promise<void> => {
    try {
      await switchWorkspace.mutateAsync('default');
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const handleRemoveWorkspace = async (): Promise<void> => {
    const target = pendingRemoval;
    setPendingRemoval(null);
    if (!target) return;
    try {
      await switchWorkspace.mutateAsync('default');
      await deleteWorkspace.mutateAsync(target.id);
      setToast({ variant: 'success', message: `${target.name} removido` });
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const canvasTabs: WorkbenchTab[] = fileTabs.map((tab): WorkbenchTab => ({
    id: tab.id,
    glyph: FileIcon,
    label: tab.relPath.split('/').pop() || tab.relPath,
    onClose: () => closeFileTab(tab.id),
    render: () => <FilePreviewPane path={tab.relPath} {...(selectedProjectId ? { projectId: selectedProjectId } : {})} />,
  }));

  const emptyCanvasState = (
    <EmptyState
      glyph={FileX}
      title="Nenhum arquivo aberto"
      description="Escolha um arquivo no painel de Arquivos para abrir aqui."
      testId="workbench-empty"
    />
  );

  const showGlobalToggle = activeWorkspace !== undefined && !activeWorkspace.isDefault;

  const railSection = (label: string, children: React.ReactNode) => (
    <Box>
      <Box sx={{ px: 1.5, py: 1 }}>
        <Kicker>{label}</Kicker>
      </Box>
      <List disablePadding>{children}</List>
    </Box>
  );

  return (
    <Container component="main" data-testid="workspace-screen" maxWidth="lg" sx={{ py: 2.5 }}>
      <ScreenHeader
        kicker={selectedProject ? 'Project' : activeWorkspace?.isDefault ? 'Workspace · Global' : 'Workspace'}
        title={selectedProject ? selectedProject.name : (activeWorkspace?.name ?? '…')}
        subtitle={selectedProject ? selectedProject.path : (activeWorkspace?.rootPath ?? '')}
        actions={
          selectedProject ? (
            <>
              {showGlobalToggle && (
                <Tooltip title={showGlobal ? 'Ocultar entidades globais' : 'Mostrar entidades globais'}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Icon glyph={showGlobal ? EyeOff : Eye} size={16} />}
                    data-testid="workspace-toggle-global"
                    onClick={() => setShowGlobal((v) => !v)}
                  >
                    {showGlobal ? 'Ocultar globais' : 'Mostrar globais'}
                  </Button>
                </Tooltip>
              )}
              {finishedSessionsToggle}
              {filesToggle}
              <Button
                variant="outlined"
                size="small"
                startIcon={<Icon glyph={SquareTerminal} size={16} />}
                data-testid={`project-open-session-${selectedProject.id}`}
                onClick={() => focusSession({ kind: 'project', projectId: selectedProject.id }, selectedProject.name)}
              >
                Abrir sessão
              </Button>
              <Tooltip title="Remover projeto">
                <IconButton
                  data-testid={`project-delete-${selectedProject.id}`}
                  aria-label="Remover projeto"
                  onClick={() => void handleDeleteProject(selectedProject.id)}
                >
                  <Icon glyph={Trash2} size={16} />
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <>
              {showGlobalToggle && (
                <Tooltip title={showGlobal ? 'Ocultar entidades globais' : 'Mostrar entidades globais'}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Icon glyph={showGlobal ? EyeOff : Eye} size={16} />}
                    data-testid="workspace-toggle-global"
                    onClick={() => setShowGlobal((v) => !v)}
                  >
                    {showGlobal ? 'Ocultar globais' : 'Mostrar globais'}
                  </Button>
                </Tooltip>
              )}
              {finishedSessionsToggle}
              {filesToggle}
              <Button
                variant="outlined"
                size="small"
                startIcon={<Icon glyph={SquareTerminal} size={16} />}
                data-testid="workspace-open-session"
                disabled={!activeWorkspace}
                onClick={() =>
                  activeWorkspace && focusSession({ kind: 'workspace', workspaceId: activeWorkspace.id }, activeWorkspace.name)
                }
              >
                Abrir sessão
              </Button>
              {showGlobalToggle && activeWorkspace && (
                <Tooltip title="Remover workspace">
                  <IconButton
                    data-testid="workspace-context-remove"
                    aria-label="Remover workspace"
                    onClick={() => setPendingRemoval(activeWorkspace)}
                  >
                    <Icon glyph={Trash2} size={16} />
                  </IconButton>
                </Tooltip>
              )}
            </>
          )
        }
      />

      {activeWorkspace?.isDefault ? (
        <Paper variant="outlined" sx={{ p: 0, display: 'flex', minHeight: 420 }}>
          <Box sx={{ width: 280, flexShrink: 0, borderRight: 1, borderColor: 'divider', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <List disablePadding>
              <SessionsTreeGroup showFinished={showFinishedSessions} onOpen={focusSession} />
            </List>
            <Divider />
            {railSection(
              'Customizations',
              <>
                <InstructionTreeRow
                  kind="personal"
                  instruction={personalInstruction}
                  seed={() => blankCustomization('instruction') as Instruction}
                  onOpen={openInstructionEditor}
                />
                <EntityTreeGroup kind="skill" label="Skills" showGlobal={false} onEdit={openEntityDialog} />
                <EntityTreeGroup kind="agent" label="Agents" showGlobal={false} onEdit={openEntityDialog} />
                <HooksTreeGroup showGlobal={false} />
                <McpTreeGroup showGlobal={false} />
                <PluginsTreeGroup showGlobal={false} />
              </>,
            )}
          </Box>
          <Divider orientation="vertical" flexItem />
          <WorkbenchCanvas tabs={canvasTabs} activeTabId={activeTabId} onSelect={setActiveTabId} emptyState={emptyCanvasState} />
          {showFiles && (
            <>
              <Divider orientation="vertical" flexItem />
              <Box sx={{ width: 280, flexShrink: 0, overflowY: 'auto' }} data-testid="workspace-files-panel">
                <WorkspaceManagementList />
              </Box>
            </>
          )}
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: 0, display: 'flex', minHeight: 420 }}>
          <Box sx={{ width: 280, flexShrink: 0, borderRight: 1, borderColor: 'divider', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <List disablePadding>
              <SessionsTreeGroup showFinished={showFinishedSessions} onOpen={focusSession} />
            </List>
            <Divider />
            {railSection('Customizations', customizationRows)}
          </Box>
          <Divider orientation="vertical" flexItem />
          <WorkbenchCanvas tabs={canvasTabs} activeTabId={activeTabId} onSelect={setActiveTabId} emptyState={emptyCanvasState} />
          {showFiles && (
            <>
              <Divider orientation="vertical" flexItem />
              <Box sx={{ width: 280, flexShrink: 0, overflowY: 'auto' }} data-testid="workspace-files-panel">
                <FolderTree
                  onSelectFile={openFileTab}
                  onUseAsProject={(absolutePath) => void handleUseAsProject(absolutePath)}
                  onManageProject={selectProject}
                  onNavigateUp={exitProjectScope}
                  onNavigateHome={() => void handleNavigateHome()}
                  projects={projects}
                  {...(activeWorkspace ? { workspaceRootPath: activeWorkspace.rootPath } : {})}
                  {...(selectedProjectId ? { scopeProjectId: selectedProjectId } : {})}
                />
              </Box>
            </>
          )}
        </Paper>
      )}

      <EntityEditorDialog
        state={entityDialog}
        onClose={() => setEntityDialog(null)}
        onSaved={(saved) => setEntityDialog((cur) => (cur ? ({ ...cur, entity: saved, isCreate: false } as EntityDialogState) : cur))}
        onToast={setToast}
      />

      <WorkspaceRemoveConfirmDialog
        open={pendingRemoval !== null}
        workspaceName={pendingRemoval?.name ?? ''}
        onConfirm={() => void handleRemoveWorkspace()}
        onCancel={() => setPendingRemoval(null)}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Container>
  );
}
