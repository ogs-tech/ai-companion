import { useState } from 'react';
import { Box, Button, Container, Divider, IconButton, List, Paper, Tooltip } from '@mui/material';
import { SquareTerminal, Trash2 } from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { ScreenHeader } from '../../components/ds/ScreenHeader.js';
import { FolderTree } from '../../components/workspace/FolderTree.js';
import { FilePreviewPane } from '../../components/workspace/FilePreviewPane.js';
import { SessionDialog } from '../../components/workspace/SessionDialog.js';
import { WorkspaceManagementList } from '../../components/workspace/WorkspaceManagementList.js';
import { InstructionTreeRow } from '../../components/workspace/InstructionTreeRow.js';
import { CustomizationEditor, type EditorHiddenField } from '../../components/CustomizationEditor.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import { seedProjectInstruction, seedWorkspaceInstruction } from '../../lib/instruction-seed.js';
import { useActiveWorkspace, useSwitchWorkspace } from '../../hooks/use-workspaces.js';
import { useDeleteProject, useFindOrCreateProjectByPath, useProjects } from '../../hooks/use-projects.js';
import {
  useInvalidateInstructions,
  usePersonalInstruction,
  useProjectInstruction,
  useWorkspaceInstruction,
} from '../../hooks/use-instructions.js';
import { isPersonalInstruction } from '../../../shared/entity.js';
import type { Instruction } from '../../../shared/entity.js';
import type { SessionAnchor } from '../../../shared/session.js';

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
  const invalidateInstructions = useInvalidateInstructions();

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [sessionAnchor, setSessionAnchor] = useState<SessionAnchor | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

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

  const openSession = (anchor: SessionAnchor, title: string): void => {
    setSessionAnchor(anchor);
    setSessionTitle(title);
  };

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

  return (
    <Container component="main" data-testid="workspace-screen" maxWidth="lg" sx={{ py: 2.5 }}>
      <ScreenHeader
        kicker={selectedProject ? 'Project' : activeWorkspace?.isDefault ? 'Workspace · Global' : 'Workspace'}
        title={selectedProject ? selectedProject.name : (activeWorkspace?.name ?? '…')}
        subtitle={selectedProject ? selectedProject.path : (activeWorkspace?.rootPath ?? '')}
        actions={
          selectedProject ? (
            <>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Icon glyph={SquareTerminal} size={16} />}
                data-testid={`project-open-session-${selectedProject.id}`}
                onClick={() => openSession({ kind: 'project', projectId: selectedProject.id }, selectedProject.name)}
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
            <Button
              variant="outlined"
              size="small"
              startIcon={<Icon glyph={SquareTerminal} size={16} />}
              data-testid="workspace-open-session"
              disabled={!activeWorkspace}
              onClick={() =>
                activeWorkspace && openSession({ kind: 'workspace', workspaceId: activeWorkspace.id }, activeWorkspace.name)
              }
            >
              Abrir sessão
            </Button>
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
          </List>
          <WorkspaceManagementList />
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: 0, display: 'flex', minHeight: 420 }}>
          <Box sx={{ width: 320, borderRight: 1, borderColor: 'divider', overflowY: 'auto' }}>
            <FolderTree
              instructionRow={instructionRow}
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

      <SessionDialog
        open={sessionAnchor !== null}
        anchor={sessionAnchor}
        title={sessionTitle}
        onClose={() => setSessionAnchor(null)}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Container>
  );
}
