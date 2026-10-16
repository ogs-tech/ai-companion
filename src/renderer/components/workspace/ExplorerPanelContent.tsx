import { Box, Stack, ToggleButton, ToggleButtonGroup, type SxProps, type Theme } from '@mui/material';
import { FolderTree } from './FolderTree.js';
import { WorkspaceManagementList } from './WorkspaceManagementList.js';
import { GitView } from './git/GitView.js';
import type { GitDiffSource } from '../../../shared/git.js';
import type { Workspace } from '../../../shared/workspace.js';
import { useWorkspaces } from '../../hooks/use-workspaces.js';

export type ExplorerView = 'files' | 'git';

interface ExplorerPanelContentProps {
  /** `null` at Início; `undefined` while loading. */
  activeWorkspace: Workspace | null | undefined;
  /** True at Início (no workspace open) — shows the Workspaces/App sections instead of a file tree. */
  isHome: boolean;
  /** Arquivos | Git — owned by the screen, so the overview's "Ver alterações" can switch it. */
  view: ExplorerView;
  onViewChange: (view: ExplorerView) => void;
  /** Trailing actions on the Files/Git toggle row, e.g. the "Reler do disco" refresh button. */
  toolbarActions?: React.ReactNode;
  /** Início only: Starter Pack/Marketplaces/Diagnóstico's own rows. */
  appAreaRows: React.ReactNode;
  onSelectFile: (relPath: string) => void;
  onOpenAsWorkspace: (absolutePath: string) => void;
  onPreviewFile: (relPath: string) => void;
  onNewAction: (relPath: string) => void;
  /** Content pinned above the folders/files — e.g. the workspace's Launch Configurations group. */
  pinnedRows?: React.ReactNode;
  onOpenGitDiff: (args: { path: string; source: GitDiffSource }) => void;
}

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
 * The left panel — "where": at Início, the Workspaces and App sections; in a
 * workspace, the Arquivos | Git segmented control over the file tree or the
 * git view. The context itself (name, path, switch, remove) lives in the
 * TopNav's context switcher.
 */
export function ExplorerPanelContent({
  activeWorkspace,
  isHome,
  view,
  onViewChange,
  toolbarActions,
  appAreaRows,
  onSelectFile,
  onOpenAsWorkspace,
  onPreviewFile,
  onNewAction,
  pinnedRows,
  onOpenGitDiff,
}: ExplorerPanelContentProps): React.ReactElement {
  const { data: workspaces } = useWorkspaces();
  const root = activeWorkspace?.rootPath;
  // Registered roots are stored as real paths; a sub-folder matches when its
  // path under this root is one of them.
  const registeredRoots = new Set((workspaces ?? []).map((w) => w.rootPath));
  const isWorkspaceRoot = (relPath: string): boolean => root !== undefined && registeredRoots.has(`${root}/${relPath}`);

  if (isHome) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <WorkspaceManagementList appAreaRows={appAreaRows} />
      </Box>
    );
  }

  return (
    <>
      <Box sx={{ flexShrink: 0, px: 1.25, pt: 0.75, pb: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            fullWidth
            value={view}
            onChange={(_, next: ExplorerView | null) => next && onViewChange(next)}
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
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {view === 'git' ? (
          <GitView visible onOpenDiff={onOpenGitDiff} />
        ) : (
          <FolderTree
            onSelectFile={onSelectFile}
            onOpenAsWorkspace={onOpenAsWorkspace}
            onPreviewFile={onPreviewFile}
            onNewAction={onNewAction}
            isWorkspaceRoot={isWorkspaceRoot}
            {...(pinnedRows !== undefined ? { pinnedRows } : {})}
          />
        )}
      </Box>
    </>
  );
}
