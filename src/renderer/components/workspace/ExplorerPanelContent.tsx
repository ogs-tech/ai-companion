import { useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useQueries } from '@tanstack/react-query';
import { FolderTree as FilesGlyph, Globe, GitBranch, Search, Settings as SettingsGlyph, SquareTerminal } from 'lucide-react';
import { SectionHeader } from '../ds/ContainerChrome.js';
import { FolderTree, type RootInfo } from './FolderTree.js';
import type { ExplorerActions, PathChange } from './use-explorer-actions.js';
import { WorkspacesList } from './WorkspacesList.js';
import { ConfigTree } from './ConfigTree.js';
import { ExplorerFrame, ExplorerRail, type ExplorerView, type RailItem } from './ExplorerRail.js';
import { useTerminals } from '../../hooks/use-terminals.js';
import { DiscardConfirmDialog } from './git/DiscardConfirmDialog.js';
import { RepositoriesView, SingleRepoGitView } from './git/GitViews.js';
import { RepoMeta } from './git/RepoMeta.js';
import { buildGitDecorations } from './git/git-decorations.js';
import { useGitActions } from './git/use-git-actions.js';
import { gitStatusOptions } from '../../hooks/use-git.js';
import { folderRoutingFor } from '../../hooks/use-folder-routing.js';
import { useWorkspaces } from '../../hooks/use-workspaces.js';
import type { GitDiffSource, GitFileChange } from '../../../shared/git.js';
import type { Workspace } from '../../../shared/workspace.js';

interface ExplorerPanelContentProps {
  /** Root-relative paths of open file tabs with unsaved changes (conflict marks in the tree). */
  dirtyFiles?: ReadonlySet<string>;
  /** `null` at Início; `undefined` while loading. */
  activeWorkspace: Workspace | null | undefined;
  /** True at Início (no workspace open) — the rail holds the app's destinations and the body is the workspaces list. */
  isHome: boolean;
  /** Git status polls only while the panel is on screen. */
  gitPolling: boolean;
  /** Trailing actions on the Arquivos section header, e.g. hidden files and the "Reler do disco" refresh. */
  toolbarActions?: React.ReactNode;
  /** Início only: the rail's destinations — Workspaces, Starter Pack, Marketplaces, Diagnóstico. */
  homeRailItems: readonly RailItem[];
  /** Início only: "Ver todos (n)…" in the workspaces list. */
  onOpenWorkspaces: () => void;
  onSelectFile: (relPath: string) => void;
  onOpenAsWorkspace: (absolutePath: string) => void;
  onPreviewFile: (relPath: string) => void;
  onNewAction: (relPath: string) => void;
  /** The Editores abertos section, pinned at the top of the Arquivos view. */
  openEditorsSection?: React.ReactNode;
  /** The Terminais view's body (rendered with `fill`). */
  terminalsSection?: React.ReactNode;
  /** Right-click a folder/file → "Abrir terminal aqui". */
  onOpenTerminalHere?: (relDir: string) => void;
  onOpenGitDiff: (args: { path: string; source: GitDiffSource }) => void;
  /** Clicking the active rail icon again collapses the panel. */
  onCollapse?: () => void;
  /** Controlled view, so the screen can open Git ("Ver alterações"); uncontrolled when omitted. */
  view?: ExplorerView;
  onViewChange?: (view: ExplorerView) => void;
  /** Open tabs follow a renamed or moved path. */
  onRetarget?: (changes: PathChange[]) => void;
  /** Open tabs under these paths were trashed. */
  onRemoved?: (paths: string[]) => void;
  /** Hands the screen the Explorer's controller (undo, paste) so menu commands can reach it. */
  onExplorerActions?: (actions: ExplorerActions) => void;
  /** The Navegador view's body (rendered with `fill`). */
  browserSection?: React.ReactNode;
  /** The "Buscar no projeto" view's body (rendered with `fill`). */
  searchSection?: React.ReactNode;
  /** The Config page whose tab is in front (highlighted in the Config tree). */
  activeConfigPage: string | null;
  onOpenConfigPage: (page: string) => void;
}

/**
 * The left panel, one anatomy in every scope: the rail says where you are, a
 * section header says what you see, the body is the content. Início's rail
 * holds the app's destinations over the workspaces list; a workspace's rail
 * is Arquivos · Git · Terminais, over one or several folders. The context
 * itself (name, path, switch, remove) lives in the TopNav's switcher.
 */
export function ExplorerPanelContent(props: ExplorerPanelContentProps): React.ReactElement {
  const { data: workspaces } = useWorkspaces();
  const { activeWorkspace, isHome } = props;
  const [localView, setLocalView] = useState<ExplorerView>('files');
  const view = props.view ?? localView;
  const setView = props.onViewChange ?? setLocalView;
  const root = activeWorkspace?.rootPath;
  // Registered roots are stored as real paths; a sub-folder matches when its
  // path under this root is one of them.
  const registeredRoots = new Set((workspaces ?? []).map((w) => w.rootPath));
  const isWorkspaceRoot = (relPath: string): boolean => root !== undefined && registeredRoots.has(`${root}/${relPath}`);
  const onSelectView = (next: ExplorerView): void => {
    if (next === view) props.onCollapse?.();
    else setView(next);
  };

  if (isHome) {
    // Início's rail is destinations that open tabs, plus Config — the one entry that swaps the body.
    const homeItems: RailItem[] = [
      ...props.homeRailItems,
      {
        testId: 'explorer-view-config',
        label: 'Configurações',
        glyph: SettingsGlyph,
        active: view === 'config',
        onClick: () => setView(view === 'config' ? 'files' : 'config'),
      },
    ];
    return (
      <ExplorerFrame rail={<ExplorerRail items={homeItems} />}>
        {view === 'config' ? (
          <ConfigTree activePage={props.activeConfigPage} onOpenPage={props.onOpenConfigPage} />
        ) : (
          <WorkspacesList onOpenWorkspaces={props.onOpenWorkspaces} />
        )}
      </ExplorerFrame>
    );
  }

  return <WorkspaceExplorer {...props} workspace={activeWorkspace ?? undefined} view={view} onSelectView={onSelectView} isWorkspaceRoot={isWorkspaceRoot} />;
}

interface WorkspaceExplorerProps extends Omit<ExplorerPanelContentProps, 'activeWorkspace' | 'isHome' | 'view' | 'onViewChange'> {
  workspace: Workspace | undefined;
  view: ExplorerView;
  onSelectView: (view: ExplorerView) => void;
  isWorkspaceRoot: (relPath: string) => boolean;
}

/**
 * A workspace's panel — one folder is just the N=1 case of several. Split
 * out so Início never mounts the git hooks (there is no repo to query there).
 * With several folders the tree's paths start with the folder's alias and git
 * calls are routed back to the folder by that first segment.
 */
function WorkspaceExplorer({
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
  dirtyFiles,
  activeConfigPage,
  onOpenConfigPage,
  view,
  onSelectView,
  onRetarget,
  onRemoved,
  onExplorerActions,
  searchSection,
  browserSection,
}: WorkspaceExplorerProps): React.ReactElement {
  const routing = useMemo(() => folderRoutingFor(workspace), [workspace]);
  const { multi, aliases } = routing;
  // A single folder is the workspace itself: its git calls carry no folder.
  const targets = useMemo<Array<string | undefined>>(() => (multi ? routing.folders : [undefined]), [multi, routing.folders]);
  const actions = useGitActions();
  const { data: terminals = [] } = useTerminals();

  // Same query keys as each Git view's own status, so this adds no requests.
  const statuses = useQueries({ queries: targets.map((folder) => gitStatusOptions(folder, gitPolling)) });
  const statusSignature = statuses.map((q) => q.dataUpdatedAt).join(',');
  const files = useMemo(
    () => statuses.flatMap((q, i) => (q.data?.isRepo ? q.data.files.map((f) => ({ ...f, path: routing.join(targets[i], f.path) })) : [])),
    // `statusSignature` stands for the query results, which change identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusSignature, targets, routing],
  );
  const decorations = useMemo(() => buildGitDecorations(files), [files]);
  const reposKnown = statuses.every((q) => q.data !== undefined);
  const anyRepo = statuses.some((q) => q.data?.isRepo);

  /** Groups workspace-relative paths by the folder they belong to, with folder-relative paths. */
  const byFolder = (paths: string[]): Map<string | undefined, string[]> => {
    const groups = new Map<string | undefined, string[]>();
    for (const path of paths) {
      const { folder, rel } = routing.split(path);
      groups.set(folder, [...(groups.get(folder) ?? []), rel]);
    }
    return groups;
  };

  const rootInfo = useMemo<Record<string, RootInfo> | undefined>(() => {
    if (!multi) return undefined;
    return Object.fromEntries(
      routing.folders.map((folder, i) => {
        const alias = aliases[folder] as string;
        const data = statuses[i]?.data;
        const clean = data !== undefined && !(data.isRepo && data.files.length > 0);
        return [alias, { meta: <RepoMeta status={data} testId={`folder-meta-${alias}`} />, muted: clean }];
      }),
    );
    // `statusSignature` stands for the query results, which change identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi, routing, aliases, statusSignature]);

  const items: RailItem[] = [
    { testId: 'explorer-view-files', label: 'Arquivos', glyph: FilesGlyph, active: view === 'files', onClick: () => onSelectView('files') },
    { testId: 'explorer-view-search', label: 'Buscar', glyph: Search, active: view === 'search', onClick: () => onSelectView('search') },
    {
      testId: 'explorer-view-git',
      label: 'Git',
      glyph: GitBranch,
      active: view === 'git',
      onClick: () => onSelectView('git'),
      ...(anyRepo ? { count: files.length } : {}),
      dimmed: reposKnown && !anyRepo,
    },
    {
      testId: 'explorer-view-terminals',
      label: 'Terminais',
      glyph: SquareTerminal,
      active: view === 'terminals',
      onClick: () => onSelectView('terminals'),
      count: terminals.filter((t) => t.status === 'running').length,
      badgeColor: 'success',
    },
    { testId: 'explorer-view-browser', label: 'Navegador', glyph: Globe, active: view === 'browser', onClick: () => onSelectView('browser') },
    { testId: 'explorer-view-config', label: 'Configurações', glyph: SettingsGlyph, active: view === 'config', onClick: () => onSelectView('config') },
  ];

  return (
    <ExplorerFrame rail={<ExplorerRail items={items} />}>
      {view === 'files' && (
        <>
          <SectionHeader level="view" title="Arquivos" testId="explorer-files-header" actions={toolbarActions} />
          {openEditorsSection}
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {/* Waits for the workspace so the root node is there from the first render — adding it later would remount every row. */}
            {workspace !== undefined && <FolderTree
              onSelectFile={onSelectFile}
              onOpenAsWorkspace={onOpenAsWorkspace}
              onPreviewFile={onPreviewFile}
              onNewAction={onNewAction}
              isWorkspaceRoot={isWorkspaceRoot}
              {...(dirtyFiles !== undefined ? { dirtyFiles } : {})}
              multi={multi}
              {...(onRetarget !== undefined ? { onRetarget } : {})}
              {...(onRemoved !== undefined ? { onRemoved } : {})}
              {...(onExplorerActions !== undefined ? { onActions: onExplorerActions } : {})}
              {...(!multi && workspace !== undefined
                ? {
                    root: {
                      label: workspace.rootPath.split('/').filter(Boolean).pop() ?? workspace.name,
                      absolutePath: workspace.rootPath,
                      meta: <RepoMeta status={statuses[0]?.data} testId="folder-meta-root" />,
                    },
                  }
                : {})}
              {...(onOpenTerminalHere !== undefined ? { onOpenTerminalHere } : {})}
              {...(rootInfo !== undefined ? { rootInfo } : {})}
              {...(anyRepo
                ? {
                    git: {
                      decorations,
                      busy: actions.busy,
                      onOpenDiff: onOpenGitDiff,
                      onStage: (paths: string[]) => byFolder(paths).forEach((rels, folder) => actions.stage(rels, folder)),
                      onUnstage: (paths: string[]) => byFolder(paths).forEach((rels, folder) => actions.unstage(rels, folder)),
                      onDiscard: (changes: GitFileChange[]) => {
                        // One confirmation per folder keeps each discard targeted at a single repository.
                        const first = changes[0];
                        if (!first) return;
                        const { folder } = routing.split(first.path);
                        const sameFolder = changes.filter((c) => routing.split(c.path).folder === folder);
                        actions.requestDiscard(
                          sameFolder.map((c) => ({ ...c, path: routing.split(c.path).rel })),
                          folder,
                        );
                      },
                    },
                  }
                : {})}
            />}
          </Box>
        </>
      )}
      {view === 'search' && searchSection}
      {view === 'git' &&
        (multi ? (
          <RepositoriesView routing={routing} gitPolling={gitPolling} onOpenGitDiff={onOpenGitDiff} />
        ) : (
          <SingleRepoGitView workspaceId={workspace?.id} gitPolling={gitPolling} onOpenGitDiff={onOpenGitDiff} />
        ))}
      {view === 'terminals' && terminalsSection}
      {view === 'browser' && browserSection}
      {view === 'config' && <ConfigTree activePage={activeConfigPage} onOpenPage={onOpenConfigPage} />}
      <DiscardConfirmDialog files={actions.pendingDiscard} onCancel={actions.cancelDiscard} onConfirm={actions.confirmDiscard} />
    </ExplorerFrame>
  );
}
