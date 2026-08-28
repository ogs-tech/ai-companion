import { useState } from 'react';
import { Box, Button, Container, Divider, IconButton, List, Paper, Tooltip } from '@mui/material';
import { Eye, EyeOff, SquareTerminal, Trash2 } from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { ScreenHeader } from '../../components/ds/ScreenHeader.js';
import { FolderTree } from '../../components/workspace/FolderTree.js';
import { FilePreviewPane } from '../../components/workspace/FilePreviewPane.js';
import { WorkspaceManagementList } from '../../components/workspace/WorkspaceManagementList.js';
import { InstructionTreeRow } from '../../components/workspace/InstructionTreeRow.js';
import { EntityTreeGroup } from '../../components/workspace/EntityTreeGroup.js';
import { HooksTreeGroup } from '../../components/workspace/HooksTreeGroup.js';
import { McpTreeGroup } from '../../components/workspace/McpTreeGroup.js';
import { PluginsTreeGroup } from '../../components/workspace/PluginsTreeGroup.js';
import { SessionsTreeGroup } from '../../components/workspace/SessionsTreeGroup.js';
import { CustomizationEditor, type EditorHiddenField } from '../../components/CustomizationEditor.js';
import { WorkspaceRemoveConfirmDialog } from '../../components/shell/WorkspaceRemoveConfirmDialog.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import { seedProjectInstruction, seedWorkspaceInstruction } from '../../lib/instruction-seed.js';
import { useSessionFocus } from '../../lib/session-focus-context.js';
import { useActiveWorkspace, useDeleteWorkspace, useSwitchWorkspace } from '../../hooks/use-workspaces.js';
import { useDeleteProject, useFindOrCreateProjectByPath, useProjects } from '../../hooks/use-projects.js';
import {
  useInvalidateInstructions,
  usePersonalInstruction,
  useProjectInstruction,
  useWorkspaceInstruction,
} from '../../hooks/use-instructions.js';
import { isPersonalInstruction } from '../../../shared/entity.js';
import type { Instruction } from '../../../shared/entity.js';
import type { Workspace } from '../../../shared/workspace.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface EditorState {
  entity: Instruction;
  isCreate: boolean;
}

const PERSONAL_HIDDEN: ReadonlySet<EditorHiddenField> = new Set(['name', 'scope', 'description', 'version']);
const SCOPED_HIDDEN: ReadonlySet<EditorHiddenField> = new Set(['scope']);

export function WorkspaceScreen(): React.ReactElement {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: projects = [] } = useProjects();
  const { data: personalInstruction } = usePersonalInstruction();
  const findOrCreateProject = useFindOrCreateProjectByPath();
  const deleteProject = useDeleteProject();
  const switchWorkspace = useSwitchWorkspace();
  const deleteWorkspace = useDeleteWorkspace();
  const invalidateInstructions = useInvalidateInstructions();

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { focusSession } = useSessionFocus();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  // Hidden by default inside a project workspace, to keep the tree focused on
  // what's actually local to it — plugin-provided and Personal-scope entities
  // are already visible everywhere else, so they're the ones worth hiding.
  const [showGlobal, setShowGlobal] = useState(false);
  // Independent from showGlobal — it filters by session status (running vs. exited), not local/global scope.
  const [showFinishedSessions, setShowFinishedSessions] = useState(false);
  // Captured when the dialog opens, not read live off `activeWorkspace` — see SubRail's old WorkspaceContext, which this replaces.
  const [pendingRemoval, setPendingRemoval] = useState<Workspace | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const { data: workspaceInstruction } = useWorkspaceInstruction(activeWorkspace?.id ?? '');
  const { data: projectInstruction } = useProjectInstruction(selectedProject?.id ?? '');

  const openInstructionEditor = (entity: Instruction, isCreate: boolean): void => setEditor({ entity, isCreate });

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

  const pinnedRows = (
    <>
      <EntityTreeGroup kind="skill" label="Skills" showGlobal={showGlobal} {...(entityLocalScope ? { localScope: entityLocalScope } : {})} />
      <EntityTreeGroup kind="agent" label="Agents" showGlobal={showGlobal} {...(entityLocalScope ? { localScope: entityLocalScope } : {})} />
      <HooksTreeGroup isProjectContext showGlobal={showGlobal} />
      <McpTreeGroup showGlobal={showGlobal} {...(mcpMatchPath ? { matchPath: mcpMatchPath } : {})} />
      <PluginsTreeGroup isProjectContext showGlobal={showGlobal} />
      <SessionsTreeGroup showFinished={showFinishedSessions} onOpen={focusSession} />
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

  const selectProject = (id: string): void => {
    setSelectedProjectId(id);
    setSelectedFile(null);
  };

  const exitProjectScope = (): void => {
    setSelectedProjectId(null);
    setSelectedFile(null);
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

  if (editor) {
    const isPersonal = isPersonalInstruction(editor.entity);
    return (
      <CustomizationEditor
        initial={editor.entity}
        isCreate={editor.isCreate}
        hiddenFields={isPersonal ? PERSONAL_HIDDEN : SCOPED_HIDDEN}
        enableGenerate={isPersonal}
        titleOverride={
          isPersonal
            ? { create: 'Configurar Personal Instruction', edit: 'Editar Personal Instruction' }
            : { create: `Nova instruction (${editor.entity.name})`, edit: `Editar ${editor.entity.name}` }
        }
        onSaved={async (saved) => {
          // Stay in the editor with the saved entity instead of bouncing back
          // to Visão Geral — a brand-new instruction only gets a real urn once
          // saved, and closing here would strand the user right when the
          // Session panel becomes usable.
          setEditor({ entity: saved as Instruction, isCreate: false });
          await invalidateInstructions();
          setToast({ variant: 'success', message: 'Instruction salva' });
        }}
        onCancel={() => setEditor(null)}
      />
    );
  }

  const showGlobalToggle = activeWorkspace !== undefined && !activeWorkspace.isDefault;

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
        <Paper variant="outlined" sx={{ p: 0, mb: 2 }}>
          <List disablePadding>
            <InstructionTreeRow
              kind="personal"
              instruction={personalInstruction}
              seed={() => blankCustomization('instruction') as Instruction}
              onOpen={openInstructionEditor}
            />
            <EntityTreeGroup kind="skill" label="Skills" showGlobal={false} />
            <EntityTreeGroup kind="agent" label="Agents" showGlobal={false} />
            <HooksTreeGroup showGlobal={false} />
            <McpTreeGroup showGlobal={false} />
            <PluginsTreeGroup showGlobal={false} />
            <SessionsTreeGroup showFinished={showFinishedSessions} onOpen={focusSession} />
          </List>
          <WorkspaceManagementList />
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: 0, display: 'flex', minHeight: 420 }}>
          <Box sx={{ width: 320, borderRight: 1, borderColor: 'divider', overflowY: 'auto' }}>
            <FolderTree
              instructionRow={instructionRow}
              pinnedRows={pinnedRows}
              onSelectFile={setSelectedFile}
              onUseAsProject={(absolutePath) => void handleUseAsProject(absolutePath)}
              onManageProject={selectProject}
              onNavigateUp={exitProjectScope}
              onNavigateHome={() => void handleNavigateHome()}
              projects={projects}
              {...(activeWorkspace ? { workspaceRootPath: activeWorkspace.rootPath } : {})}
              {...(selectedProjectId ? { scopeProjectId: selectedProjectId } : {})}
            />
          </Box>
          <Divider orientation="vertical" flexItem />
          <Box sx={{ flexGrow: 1, p: 2, overflow: 'auto' }}>
            <FilePreviewPane path={selectedFile} {...(selectedProjectId ? { projectId: selectedProjectId } : {})} />
          </Box>
        </Paper>
      )}

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
