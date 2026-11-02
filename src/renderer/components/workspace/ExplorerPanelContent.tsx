import { useMemo, useState } from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { FolderTree } from './FolderTree.js';
import { HomeNavList } from './HomeNavList.js';
import { ExplorerToolbar } from './ExplorerToolbar.js';
import { ExplorerFrame, ExplorerRail, type ExplorerView } from './ExplorerRail.js';
import { GitChangesList } from './git/GitChangesList.js';
import { useTerminals } from '../../hooks/use-terminals.js';
import { DiscardConfirmDialog } from './git/DiscardConfirmDialog.js';
import { GitErrorAlert } from './git/GitErrorAlert.js';
import { GitInitCard } from './git/GitInit.js';
import { buildGitDecorations } from './git/git-decorations.js';
import { useGitActions } from './git/use-git-actions.js';
import { useGitStatus } from '../../hooks/use-git.js';
import type { GitDiffSource } from '../../../shared/git.js';
import { workspaceFolders, type Workspace } from '../../../shared/workspace.js';
import { MultiFolderExplorer } from './MultiFolderExplorer.js';
import { useWorkspaces } from '../../hooks/use-workspaces.js';

interface ExplorerPanelContentProps {
  /** `null` at Início; `undefined` while loading. */
  activeWorkspace: Workspace | null | undefined;
  /** True at Início (no workspace open) — shows the navigation menu instead of a file tree. */
  isHome: boolean;
  /** Git status polls only while the panel is on screen. */
  gitPolling: boolean;
  /** Trailing actions on the Arquivos header, e.g. the "Reler do disco" refresh button. */
  toolbarActions?: React.ReactNode;
  /** Início only: Starter Pack/Marketplaces/Diagnóstico's own rows. */
  appAreaRows: React.ReactNode;
  /** Início only: whether the menu's Workspaces row is the tab on screen, and how to open it. */
  homeNav: Pick<React.ComponentProps<typeof HomeNavList>, 'workspacesActive' | 'onOpenWorkspaces'>;
  onSelectFile: (relPath: string) => void;
  onOpenAsWorkspace: (absolutePath: string) => void;
  onPreviewFile: (relPath: string) => void;
  onNewAction: (relPath: string) => void;
  /** The Editores abertos section, pinned at the top of the Arquivos view (and of Início). */
  openEditorsSection?: React.ReactNode;
  /** The Terminais view's body (rendered with `fill`). */
  terminalsSection?: React.ReactNode;
  /** Right-click a folder/file → "Abrir terminal aqui". */
  onOpenTerminalHere?: (relDir: string) => void;
  onOpenGitDiff: (args: { path: string; source: GitDiffSource }) => void;
  /** The rail's Início button: leaves the workspace. */
  onGoHome?: () => void;
  /** Clicking the active rail icon again collapses the panel. */
  onCollapse?: () => void;
  /** Controlled view, so the screen can open Git ("Ver alterações"); uncontrolled when omitted. */
  view?: ExplorerView;
  onViewChange?: (view: ExplorerView) => void;
}

/** What the rail needs from whichever explorer is mounted. */
interface RailProps {
  view: ExplorerView;
  onSelectView: (view: ExplorerView) => void;
  onGoHome: () => void;
}

const noop = (): void => undefined;

/** The Arquivos view's slim header: holds the hidden-files and refresh actions. */
function FilesHeader({ trailing }: { trailing: React.ReactNode }): React.ReactElement | null {
  if (!trailing) return null;
  return (
    <Box
      data-testid="explorer-files-header"
      sx={{ flexShrink: 0, px: 1.25, py: 0.25, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}
    >
      {trailing}
    </Box>
  );
}

/**
 * The left panel — "where": a rail (Arquivos · Git · Terminais, Início at the
 * bottom) that switches what the panel shows. At Início the rail has only
 * Início active and the panel is the navigation menu. The context itself
 * (name, path, switch, remove) lives in the TopNav's context switcher.
 */
export function ExplorerPanelContent(props: ExplorerPanelContentProps): React.ReactElement {
  const { data: workspaces } = useWorkspaces();
  const { activeWorkspace, isHome, appAreaRows, homeNav, onOpenAsWorkspace } = props;
  const [localView, setLocalView] = useState<ExplorerView>('files');
  const view = props.view ?? localView;
  const setView = props.onViewChange ?? setLocalView;
  const root = activeWorkspace?.rootPath;
  // Registered roots are stored as real paths; a sub-folder matches when its
  // path under this root is one of them.
  const registeredRoots = new Set((workspaces ?? []).map((w) => w.rootPath));
  const isWorkspaceRoot = (relPath: string): boolean => root !== undefined && registeredRoots.has(`${root}/${relPath}`);
  const onGoHome = props.onGoHome ?? noop;
  const onSelectView = (next: ExplorerView): void => {
    if (next === view) props.onCollapse?.();
    else setView(next);
  };
  const railProps: RailProps = { view, onSelectView, onGoHome };

  if (isHome) {
    return (
      <ExplorerFrame rail={<ExplorerRail view={null} isHome onSelect={noop} onGoHome={noop} />}>
        {props.openEditorsSection}
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <HomeNavList {...homeNav} appAreaRows={appAreaRows} />
        </Box>
      </ExplorerFrame>
    );
  }

  if (activeWorkspace && workspaceFolders(activeWorkspace).length > 1) {
    const { gitPolling, toolbarActions, onSelectFile, onPreviewFile, onNewAction, openEditorsSection, terminalsSection, onOpenTerminalHere, onOpenGitDiff } = props;
    return (
      <MultiFolderExplorer
        workspace={activeWorkspace}
        gitPolling={gitPolling}
        {...(toolbarActions !== undefined ? { toolbarActions } : {})}
        onSelectFile={onSelectFile}
        onOpenAsWorkspace={onOpenAsWorkspace}
        onPreviewFile={onPreviewFile}
        onNewAction={onNewAction}
        {...(openEditorsSection !== undefined ? { openEditorsSection } : {})}
        {...(terminalsSection !== undefined ? { terminalsSection } : {})}
        {...(onOpenTerminalHere !== undefined ? { onOpenTerminalHere } : {})}
        onOpenGitDiff={onOpenGitDiff}
        isWorkspaceRoot={isWorkspaceRoot}
        {...railProps}
      />
    );
  }

  return <WorkspaceExplorer {...props} {...railProps} onOpenAsWorkspace={onOpenAsWorkspace} isWorkspaceRoot={isWorkspaceRoot} />;
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
  openEditorsSection,
  terminalsSection,
  onOpenTerminalHere,
  onOpenGitDiff,
  isWorkspaceRoot,
  view,
  onSelectView,
  onGoHome,
}: ExplorerPanelContentProps & RailProps & { isWorkspaceRoot: (relPath: string) => boolean }): React.ReactElement {
  const status = useGitStatus({ visible: gitPolling });
  const actions = useGitActions();
  const { data: terminals = [] } = useTerminals();
  const data = status.data;
  const repo = data?.isRepo ? data : null;
  const decorations = useMemo(() => buildGitDecorations(repo?.files ?? []), [repo?.files]);
  const runningTerminals = terminals.filter((t) => t.status === 'running').length;

  const rail = (
    <ExplorerRail
      view={view}
      onSelect={onSelectView}
      isHome={false}
      onGoHome={onGoHome}
      {...(repo ? { gitCount: repo.files.length } : {})}
      gitDimmed={data !== undefined && !data.isRepo}
      terminalCount={runningTerminals}
    />
  );

  return (
    <ExplorerFrame rail={rail}>
      {view === 'files' && (
        <>
          {openEditorsSection}
          <FilesHeader trailing={toolbarActions} />
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <FolderTree
              onSelectFile={onSelectFile}
              onOpenAsWorkspace={onOpenAsWorkspace}
              onPreviewFile={onPreviewFile}
              onNewAction={onNewAction}
              isWorkspaceRoot={isWorkspaceRoot}
              {...(onOpenTerminalHere !== undefined ? { onOpenTerminalHere } : {})}
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
          </Box>
        </>
      )}
      {view === 'git' && (
        <>
          <ExplorerToolbar status={{ isPending: status.isPending, error: status.error, data }} actions={actions} />
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {actions.error && <GitErrorAlert report={actions.error} onClose={actions.clearError} onPullAndRetry={actions.sync} />}
            {repo && repo.state !== 'clean' && (
              <Alert severity="warning" sx={{ mx: 1.5, mt: 1, mb: 1 }} data-testid="git-state-banner">
                Operação em andamento ({repo.state}). Resolva ou aborte pelo terminal.
              </Alert>
            )}
            {repo && (
              <GitChangesList
                files={repo.files}
                busy={actions.busy}
                onStage={actions.stage}
                onUnstage={actions.unstage}
                onDiscard={actions.requestDiscard}
                onOpenDiff={(path, source) => onOpenGitDiff({ path, source })}
              />
            )}
            {repo?.truncated && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.5 }} data-testid="git-truncated">
                Mostrando os primeiros {repo.files.length} arquivos.
              </Typography>
            )}
            {data && !data.isRepo && activeWorkspace && (
              <GitInitCard workspaceId={activeWorkspace.id} busy={actions.busy} onInit={actions.init} />
            )}
          </Box>
        </>
      )}
      {view === 'terminals' && terminalsSection}
      <DiscardConfirmDialog files={actions.pendingDiscard} onCancel={actions.cancelDiscard} onConfirm={actions.confirmDiscard} />
    </ExplorerFrame>
  );
}
