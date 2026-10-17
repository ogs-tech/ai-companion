import { useMemo } from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { FolderTree } from './FolderTree.js';
import { WorkspaceManagementList } from './WorkspaceManagementList.js';
import { ExplorerToolbar } from './ExplorerToolbar.js';
import { DiscardConfirmDialog } from './git/DiscardConfirmDialog.js';
import { GitErrorAlert } from './git/GitErrorAlert.js';
import { GitInitCard } from './git/GitInit.js';
import { buildGitDecorations } from './git/git-decorations.js';
import { useGitActions } from './git/use-git-actions.js';
import { useGitStatus } from '../../hooks/use-git.js';
import type { GitDiffSource } from '../../../shared/git.js';
import type { Workspace } from '../../../shared/workspace.js';
import { useWorkspaces } from '../../hooks/use-workspaces.js';

interface ExplorerPanelContentProps {
  /** `null` at Início; `undefined` while loading. */
  activeWorkspace: Workspace | null | undefined;
  /** True at Início (no workspace open) — shows the Workspaces/App sections instead of a file tree. */
  isHome: boolean;
  /** Git status polls only while the panel is on screen. */
  gitPolling: boolean;
  /** Trailing actions on the toolbar, e.g. the "Reler do disco" refresh button. */
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

/**
 * The left panel — "where": at Início, the Workspaces and App sections; in a
 * workspace, the git toolbar over one file tree decorated with git status.
 * The context itself (name, path, switch, remove) lives in the TopNav's
 * context switcher.
 */
export function ExplorerPanelContent(props: ExplorerPanelContentProps): React.ReactElement {
  const { data: workspaces } = useWorkspaces();
  const { activeWorkspace, isHome, appAreaRows, onOpenAsWorkspace } = props;
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

  return <WorkspaceExplorer {...props} onOpenAsWorkspace={onOpenAsWorkspace} isWorkspaceRoot={isWorkspaceRoot} />;
}

/** Split out so Início never mounts the git hooks (there is no repo to query there). */
function WorkspaceExplorer({
  activeWorkspace,
  gitPolling,
  toolbarActions,
  onSelectFile,
  onOpenAsWorkspace,
  onPreviewFile,
  onNewAction,
  pinnedRows,
  onOpenGitDiff,
  isWorkspaceRoot,
}: ExplorerPanelContentProps & { isWorkspaceRoot: (relPath: string) => boolean }): React.ReactElement {
  const status = useGitStatus({ visible: gitPolling });
  const actions = useGitActions();
  const data = status.data;
  const repo = data?.isRepo ? data : null;
  const decorations = useMemo(() => buildGitDecorations(repo?.files ?? []), [repo?.files]);

  return (
    <>
      <ExplorerToolbar
        status={{ isPending: status.isPending, error: status.error, data }}
        actions={actions}
        trailing={toolbarActions}
      />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {actions.error && <GitErrorAlert report={actions.error} onClose={actions.clearError} onPullAndRetry={actions.sync} />}
        {repo && repo.state !== 'clean' && (
          <Alert severity="warning" sx={{ mx: 1.5, mt: 1, mb: 1 }} data-testid="git-state-banner">
            Operação em andamento ({repo.state}). Resolva ou aborte pelo terminal.
          </Alert>
        )}
        <FolderTree
          onSelectFile={onSelectFile}
          onOpenAsWorkspace={onOpenAsWorkspace}
          onPreviewFile={onPreviewFile}
          onNewAction={onNewAction}
          isWorkspaceRoot={isWorkspaceRoot}
          {...(pinnedRows !== undefined ? { pinnedRows } : {})}
          {...(repo
            ? {
                git: {
                  decorations,
                  busy: actions.busy,
                  onOpenDiff: onOpenGitDiff,
                  onStage: actions.stage,
                  onUnstage: actions.unstage,
                  onDiscard: actions.requestDiscard,
                },
              }
            : {})}
        />
        {repo?.truncated && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.5 }} data-testid="git-truncated">
            Mostrando os primeiros {repo.files.length} arquivos.
          </Typography>
        )}
        {data && !data.isRepo && activeWorkspace && (
          <GitInitCard workspaceId={activeWorkspace.id} busy={actions.busy} onInit={actions.init} />
        )}
      </Box>
      <DiscardConfirmDialog files={actions.pendingDiscard} onCancel={actions.cancelDiscard} onConfirm={actions.confirmDiscard} />
    </>
  );
}
