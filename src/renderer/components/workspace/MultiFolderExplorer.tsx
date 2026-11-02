import { useMemo } from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { useQueries } from '@tanstack/react-query';
import { FolderTree } from './FolderTree.js';
import { ExplorerToolbar } from './ExplorerToolbar.js';
import { ExplorerFrame, ExplorerRail, type ExplorerView } from './ExplorerRail.js';
import { GitChangesList } from './git/GitChangesList.js';
import { useTerminals } from '../../hooks/use-terminals.js';
import { DiscardConfirmDialog } from './git/DiscardConfirmDialog.js';
import { GitErrorAlert } from './git/GitErrorAlert.js';
import { GitInitCard } from './git/GitInit.js';
import { buildGitDecorations } from './git/git-decorations.js';
import { useGitActions } from './git/use-git-actions.js';
import { gitStatusOptions, useGitStatus } from '../../hooks/use-git.js';
import { folderRoutingFor } from '../../hooks/use-folder-routing.js';
import { folderColor } from '../../lib/folder-identity.js';
import type { GitDiffSource, GitFileChange } from '../../../shared/git.js';
import type { Workspace } from '../../../shared/workspace.js';

interface MultiFolderExplorerProps {
  workspace: Workspace;
  gitPolling: boolean;
  toolbarActions?: React.ReactNode;
  onSelectFile: (relPath: string) => void;
  onOpenAsWorkspace: (absolutePath: string) => void;
  onPreviewFile: (relPath: string) => void;
  onNewAction: (relPath: string) => void;
  openEditorsSection?: React.ReactNode;
  terminalsSection?: React.ReactNode;
  onOpenTerminalHere?: (relDir: string) => void;
  onOpenGitDiff: (args: { path: string; source: GitDiffSource }) => void;
  isWorkspaceRoot: (relPath: string) => boolean;
  view: ExplorerView;
  onSelectView: (view: ExplorerView) => void;
  onGoHome: () => void;
}

/**
 * The left panel of a multi-folder workspace. Arquivos is one file tree whose
 * top-level rows are the folders, each with its colour; Git is one block per
 * folder (its own branch, changes, stage/commit/sync — each folder is its own
 * repository). Paths in the tree are workspace-relative, starting with the folder's
 * alias; git calls are routed back to the folder by that first segment.
 */
export function MultiFolderExplorer({
  workspace,
  gitPolling,
  toolbarActions,
  onSelectFile,
  onOpenAsWorkspace,
  onPreviewFile,
  onNewAction,
  openEditorsSection,
  terminalsSection,
  onOpenTerminalHere,
  onOpenGitDiff,
  isWorkspaceRoot,
  view,
  onSelectView,
  onGoHome,
}: MultiFolderExplorerProps): React.ReactElement {
  const routing = useMemo(() => folderRoutingFor(workspace), [workspace]);
  const { folders, aliases } = routing;
  const actions = useGitActions();

  // Same query keys as each block's own status, so this adds no requests.
  const statuses = useQueries({ queries: folders.map((folder) => gitStatusOptions(folder, gitPolling)) });
  const statusSignature = statuses.map((q) => q.dataUpdatedAt).join(',');
  const files = useMemo(
    () =>
      statuses.flatMap((q, i) => {
        const folder = folders[i] as string;
        return q.data?.isRepo ? q.data.files.map((f) => ({ ...f, path: routing.join(folder, f.path) })) : [];
      }),
    // `statusSignature` stands for the query results, which change identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusSignature, folders, routing],
  );
  const decorations = useMemo(() => buildGitDecorations(files), [files]);
  const rootColors = Object.fromEntries(folders.map((f) => [aliases[f] as string, folderColor(folders, f)]));

  /** Groups workspace-relative paths by the folder they belong to, with folder-relative paths. */
  const byFolder = (paths: string[]): Map<string | undefined, string[]> => {
    const groups = new Map<string | undefined, string[]>();
    for (const path of paths) {
      const { folder, rel } = routing.split(path);
      groups.set(folder, [...(groups.get(folder) ?? []), rel]);
    }
    return groups;
  };

  const { data: terminals = [] } = useTerminals();
  const reposKnown = statuses.every((q) => q.data !== undefined);
  const anyRepo = statuses.some((q) => q.data?.isRepo);

  const rail = (
    <ExplorerRail
      view={view}
      onSelect={onSelectView}
      isHome={false}
      onGoHome={onGoHome}
      gitCount={files.length}
      gitDimmed={reposKnown && !anyRepo}
      terminalCount={terminals.filter((t) => t.status === 'running').length}
    />
  );

  return (
    <ExplorerFrame rail={rail}>
      {view === 'files' && (
        <>
          {openEditorsSection}
          {toolbarActions && (
            <Box
              data-testid="explorer-files-header"
              sx={{ flexShrink: 0, px: 1.25, py: 0.25, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}
            >
              {toolbarActions}
            </Box>
          )}
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <FolderTree
              onSelectFile={onSelectFile}
              onOpenAsWorkspace={onOpenAsWorkspace}
              onPreviewFile={onPreviewFile}
              onNewAction={onNewAction}
              isWorkspaceRoot={isWorkspaceRoot}
              rootColors={rootColors}
              {...(onOpenTerminalHere !== undefined ? { onOpenTerminalHere } : {})}
              git={{
                decorations,
                busy: actions.busy,
                onOpenDiff: onOpenGitDiff,
                onStage: (paths) => byFolder(paths).forEach((rels, folder) => actions.stage(rels, folder)),
                onUnstage: (paths) => byFolder(paths).forEach((rels, folder) => actions.unstage(rels, folder)),
                onDiscard: (changes: GitFileChange[]) => {
                  // One confirmation per folder keeps each discard targeted at a single repository.
                  const first = changes[0];
                  if (!first) return;
                  const { folder } = routing.split(first.path);
                  const sameFolder = changes.filter((c) => routing.split(c.path).folder === folder);
                  actions.requestDiscard(sameFolder.map((c) => ({ ...c, path: routing.split(c.path).rel })), folder);
                },
              }}
            />
          </Box>
        </>
      )}
      {view === 'git' && (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {folders.map((folder) => (
            <FolderGitBlock
              key={folder}
              workspaceId={workspace.id}
              folder={folder}
              alias={aliases[folder] as string}
              color={folderColor(folders, folder)}
              gitPolling={gitPolling}
              toWorkspacePath={(path) => routing.join(folder, path)}
              onOpenGitDiff={onOpenGitDiff}
            />
          ))}
        </Box>
      )}
      {view === 'terminals' && terminalsSection}
      <DiscardConfirmDialog files={actions.pendingDiscard} onCancel={actions.cancelDiscard} onConfirm={actions.confirmDiscard} />
    </ExplorerFrame>
  );
}

interface FolderGitBlockProps {
  workspaceId: string;
  folder: string;
  alias: string;
  color: string;
  gitPolling: boolean;
  /** Folder-relative path → workspace-relative, the form diff tabs use. */
  toWorkspacePath: (path: string) => string;
  onOpenGitDiff: (args: { path: string; source: GitDiffSource }) => void;
}

/** One folder's repository: coloured header, toolbar (branch, stage, commit, sync), grouped changes, alerts and the init card. */
function FolderGitBlock({ workspaceId, folder, alias, color, gitPolling, toWorkspacePath, onOpenGitDiff }: FolderGitBlockProps): React.ReactElement {
  const status = useGitStatus({ visible: gitPolling, folder });
  const actions = useGitActions(folder);
  const data = status.data;
  const repo = data?.isRepo ? data : null;

  return (
    <Box data-testid={`folder-git-${alias}`} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, pt: 0.75 }}>
        <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
        <Typography variant="caption" noWrap sx={{ fontWeight: 600 }} title={folder}>
          {alias}
        </Typography>
      </Box>
      <ExplorerToolbar status={{ isPending: status.isPending, error: status.error, data }} actions={actions} />
      {actions.error && <GitErrorAlert report={actions.error} onClose={actions.clearError} onPullAndRetry={actions.sync} />}
      {repo && repo.state !== 'clean' && (
        <Alert severity="warning" sx={{ mx: 1.5, mt: 1, mb: 1 }}>
          {alias}: operação em andamento ({repo.state}). Resolva ou aborte pelo terminal.
        </Alert>
      )}
      {repo?.truncated && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.5 }}>
          {alias}: mostrando os primeiros {repo.files.length} arquivos.
        </Typography>
      )}
      {repo && (
        <GitChangesList
          files={repo.files}
          busy={actions.busy}
          onStage={(paths) => actions.stage(paths)}
          onUnstage={(paths) => actions.unstage(paths)}
          onDiscard={(files) => actions.requestDiscard(files)}
          onOpenDiff={(path, source) => onOpenGitDiff({ path: toWorkspacePath(path), source })}
        />
      )}
      {data && !data.isRepo && <GitInitCard workspaceId={workspaceId} busy={actions.busy} onInit={actions.init} />}
      <DiscardConfirmDialog files={actions.pendingDiscard} onCancel={actions.cancelDiscard} onConfirm={actions.confirmDiscard} />
    </Box>
  );
}
