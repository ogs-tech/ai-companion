import { useState } from 'react';
import { Box, Stack, ToggleButton, ToggleButtonGroup, type SxProps, type Theme } from '@mui/material';
import { FolderTree } from './FolderTree.js';
import { WorkspaceBreadcrumbHeader } from './WorkspaceBreadcrumbHeader.js';
import { WorkspaceManagementList } from './WorkspaceManagementList.js';
import { GitView } from './git/GitView.js';
import type { GitDiffSource } from '../../../shared/git.js';
import type { Workspace } from '../../../shared/workspace.js';

interface ExplorerPanelContentProps {
  /** `null` at Início; `undefined` while loading. */
  activeWorkspace: Workspace | null | undefined;
  /** True at Início (no workspace open) — shows the workspace list instead of a file tree. */
  isHome: boolean;
  onNavigateToWorkspace: () => void;
  /** The Explorer Panel's own "⋮" menu (global-entity visibility, panel toggles, destructive remove) — built by the parent screen, since it reaches state (both panels' collapse, `showGlobal`) that isn't local to this panel. */
  headerMenu: React.ReactNode;
  /** Trailing actions on the Files/Git toggle row, e.g. the "Reler do disco" refresh button. Início has no toggle row, so they sit beside `headerMenu` there. */
  toolbarActions?: React.ReactNode;
  /** Início only: guards a workspace switch from `WorkspaceManagementList` the same way any other scope change does. */
  beforeSwitch: () => boolean;
  /** Início only: the Personal Instruction's own pinned row. */
  personalInstructionRow: React.ReactNode;
  /** Início only: Starter Pack/Marketplaces/Diagnóstico's own pinned rows. */
  appAreaRows: React.ReactNode;
  onSelectFile: (relPath: string) => void;
  onOpenAsWorkspace: (absolutePath: string) => void;
  onPreviewFile: (relPath: string) => void;
  onNewAction: (relPath: string) => void;
  /** The active workspace's own pinned INSTRUCTIONS row, rendered above the file tree. */
  instructionRow: React.ReactNode;
  /** Content pinned below `instructionRow` and above the folders/files — e.g. the workspace's Launch Configurations group. */
  pinnedRows?: React.ReactNode;
  onOpenGitDiff: (args: { path: string; source: GitDiffSource }) => void;
}

type ExplorerView = 'files' | 'git';

/** Segmented control: a `rail` track with a borderless `paper` thumb on the selected option. */
const segmentedControlSx: SxProps<Theme> = (theme) => ({
  p: 0.25,
  gap: 0.25,
  bgcolor: theme.ogs.surfaces.rail,
  borderRadius: `${theme.ogs.radius.xs}px`,
  '& .MuiToggleButtonGroup-grouped': {
    border: 0,
    borderRadius: `${theme.ogs.radius.xs - 2}px !important`,
    m: 0,
  },
  '& .MuiToggleButton-root': {
    py: 0.125,
    textTransform: 'none',
    fontSize: '0.75rem',
    color: 'text.secondary',
    '&.Mui-selected, &.Mui-selected:hover': { bgcolor: 'background.paper', color: 'text.primary' },
  },
});

/**
 * The Explorer Panel's body inside the shared `SidePanel` card: the
 * workspace breadcrumb (with the "⋮" menu) over the Files/Git segmented
 * control, then either the workspace list (Início) or the file/entity tree.
 */
export function ExplorerPanelContent({
  activeWorkspace,
  isHome,
  onNavigateToWorkspace,
  headerMenu,
  toolbarActions,
  beforeSwitch,
  personalInstructionRow,
  appAreaRows,
  onSelectFile,
  onOpenAsWorkspace,
  onPreviewFile,
  onNewAction,
  instructionRow,
  pinnedRows,
  onOpenGitDiff,
}: ExplorerPanelContentProps): React.ReactElement {
  const [view, setView] = useState<ExplorerView>('files');

  return (
    <>
      <Box sx={{ flexShrink: 0, px: 1.25, pt: 0.75, pb: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <WorkspaceBreadcrumbHeader
          workspaceName={isHome ? 'Início' : (activeWorkspace?.name ?? '…')}
          isHome={isHome}
          path={isHome ? '~' : (activeWorkspace?.rootPath ?? '')}
          onNavigateToWorkspace={onNavigateToWorkspace}
          actions={
            isHome ? (
              <>
                {toolbarActions}
                {headerMenu}
              </>
            ) : (
              headerMenu
            )
          }
        />
        {!isHome && (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.75 }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              fullWidth
              value={view}
              onChange={(_, next: ExplorerView | null) => next && setView(next)}
              aria-label="Visão do Explorer"
              sx={segmentedControlSx}
            >
              <ToggleButton value="files" data-testid="explorer-view-files">
                Arquivos
              </ToggleButton>
              <ToggleButton value="git" data-testid="explorer-view-git">
                Git
              </ToggleButton>
            </ToggleButtonGroup>
            {toolbarActions}
          </Stack>
        )}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {isHome ? (
          <WorkspaceManagementList beforeSwitch={beforeSwitch} instructionRow={personalInstructionRow} appAreaRows={appAreaRows} />
        ) : view === 'git' ? (
          <GitView visible onOpenDiff={onOpenGitDiff} />
        ) : (
          <FolderTree
            onSelectFile={onSelectFile}
            onOpenAsWorkspace={onOpenAsWorkspace}
            onPreviewFile={onPreviewFile}
            onNewAction={onNewAction}
            instructionRow={instructionRow}
            {...(pinnedRows !== undefined ? { pinnedRows } : {})}
          />
        )}
      </Box>
    </>
  );
}
