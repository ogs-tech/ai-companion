import { useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { FolderTree } from './FolderTree.js';
import { WorkspaceBreadcrumbHeader } from './WorkspaceBreadcrumbHeader.js';
import { WorkspaceManagementList } from './WorkspaceManagementList.js';
import { GitView } from './git/GitView.js';
import type { GitDiffSource } from '../../../shared/git.js';
import type { Project } from '../../../shared/project.js';
import type { Workspace } from '../../../shared/workspace.js';

interface ExplorerPanelContentProps {
  activeWorkspace: Workspace | undefined;
  isDefaultWorkspace: boolean;
  /** The Control Panel's own current scope, only surfaced here for the header — the tree below never filters by it, it only expands folders in place. */
  selectedProject: Project | null;
  onNavigateToWorkspace: () => void;
  /** The Explorer Panel's own "⋮" menu (global-entity visibility, panel toggles, destructive remove) — built by the parent screen, since it reaches state (both panels' collapse, `showGlobal`) that isn't local to this panel. */
  headerMenu: React.ReactNode;
  /** Default workspace only: guards a workspace switch from `WorkspaceManagementList` the same way any other scope change does. */
  beforeSwitch: () => boolean;
  /** Default workspace only: the Personal Instruction's own pinned row. */
  personalInstructionRow: React.ReactNode;
  /** Default workspace only: Starter Pack/Marketplaces/Diagnóstico's own pinned rows. */
  appAreaRows: React.ReactNode;
  projects: ReadonlyArray<Project>;
  onSelectFile: (relPath: string, projectId?: string) => void;
  onUseAsProject: (absolutePath: string) => void;
  onPreviewFile: (relPath: string, projectId?: string) => void;
  onNewAction: (relPath: string, projectId?: string) => void;
  /** The active workspace's own pinned INSTRUCTIONS row, rendered above the file tree. */
  instructionRow: React.ReactNode;
  /** Content pinned below `instructionRow` and above the folders/files — e.g. the workspace-root Project's own Launch Configurations group. */
  pinnedRows?: React.ReactNode;
  renderProjectInstructionRow: (project: Project, depth: number) => React.ReactNode;
  renderProjectLaunchConfigsRow?: (project: Project, depth: number) => React.ReactNode;
  workspaceRootPath?: string;
  /** The Git view's repo picker writes the shared Project scope, so the Control Panel follows it. */
  onSelectProject: (projectId: string | null) => void;
  onOpenGitDiff: (args: { projectId?: string; path: string; source: GitDiffSource }) => void;
}

type ExplorerView = 'files' | 'git';

/**
 * The Explorer Panel's body, below the shared `SidePanel` header: the
 * workspace/project breadcrumb (with the "⋮" menu), then either the
 * workspace list (Default workspace) or the file/entity tree.
 */
export function ExplorerPanelContent({
  activeWorkspace,
  isDefaultWorkspace,
  selectedProject,
  onNavigateToWorkspace,
  headerMenu,
  beforeSwitch,
  personalInstructionRow,
  appAreaRows,
  projects,
  onSelectFile,
  onUseAsProject,
  onPreviewFile,
  onNewAction,
  instructionRow,
  pinnedRows,
  renderProjectInstructionRow,
  renderProjectLaunchConfigsRow,
  workspaceRootPath,
  onSelectProject,
  onOpenGitDiff,
}: ExplorerPanelContentProps): React.ReactElement {
  const [view, setView] = useState<ExplorerView>('files');

  return (
    <>
      <Box sx={{ flexShrink: 0, px: 1.5, pb: 1.25, borderBottom: 1, borderColor: 'divider' }}>
        <WorkspaceBreadcrumbHeader
          workspaceName={activeWorkspace?.name ?? '…'}
          isDefaultWorkspace={activeWorkspace?.isDefault ?? false}
          path={selectedProject ? selectedProject.path : (activeWorkspace?.rootPath ?? '')}
          onNavigateToWorkspace={onNavigateToWorkspace}
          actions={headerMenu}
        />
        {!isDefaultWorkspace && (
          <ToggleButtonGroup
            exclusive
            size="small"
            fullWidth
            value={view}
            onChange={(_, next: ExplorerView | null) => next && setView(next)}
            aria-label="Visão do Explorer"
            sx={{ mt: 1, '& .MuiToggleButton-root': { py: 0.25, textTransform: 'none', fontSize: '0.75rem' } }}
          >
            <ToggleButton value="files" data-testid="explorer-view-files">
              Arquivos
            </ToggleButton>
            <ToggleButton value="git" data-testid="explorer-view-git">
              Git
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {isDefaultWorkspace ? (
          <WorkspaceManagementList beforeSwitch={beforeSwitch} instructionRow={personalInstructionRow} appAreaRows={appAreaRows} />
        ) : view === 'git' ? (
          <GitView
            projectId={selectedProject?.id}
            visible
            projects={projects}
            onSelectProject={onSelectProject}
            onOpenDiff={onOpenGitDiff}
          />
        ) : (
          <FolderTree
            onSelectFile={onSelectFile}
            onUseAsProject={onUseAsProject}
            onPreviewFile={onPreviewFile}
            onNewAction={onNewAction}
            projects={projects}
            instructionRow={instructionRow}
            {...(pinnedRows !== undefined ? { pinnedRows } : {})}
            renderProjectInstructionRow={renderProjectInstructionRow}
            {...(renderProjectLaunchConfigsRow !== undefined ? { renderProjectLaunchConfigsRow } : {})}
            {...(workspaceRootPath ? { workspaceRootPath } : {})}
          />
        )}
      </Box>
    </>
  );
}
