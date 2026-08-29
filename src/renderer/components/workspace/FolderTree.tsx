import { useState } from 'react';
import { Box, Collapse, List, ListItemButton, ListItemText, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronRight, ChevronDown, Folder, File as FileIcon, FolderInput, FolderOpen, FolderX } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { EmptyState } from '../ds/EmptyState.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { RowContextMenu, useRowContextMenu } from './RowContextMenu.js';
import { useDirListing, useResolveAbsolutePath } from '../../hooks/use-file-browser.js';
import { SessionStatusBadge } from '../SessionStatusBadge.js';
import type { FileBrowserEntry } from '../../../shared/file-browser.js';
import type { Project } from '../../../shared/project.js';

interface PreviewTarget {
  relPath: string;
  projectId?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A depth-0 folder's absolute path is always `<workspace root>/<folder name>`. */
function joinRootPath(root: string, name: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${name}`;
}

interface FolderTreeProps {
  /**
   * `projectId` is the file's own scope — the closest ancestor Project, whether
   * that's an explicit `scopeProjectId` or a root-level folder expanded in place
   * because it matched a registered Project. Callers must route reads/writes
   * through that project, not whatever project (if any) the screen itself is
   * currently scoped to — those can differ when a Project folder is browsed
   * inline without "entering" it.
   */
  onSelectFile: (relPath: string, projectId?: string) => void;
  onUseAsProject: (absolutePath: string) => void;
  /** Right-click on a file row → "Preview" — opens a read-only rendered-Markdown tab instead of the normal editing tab. Omitted rows (folders, Project shortcuts) simply don't get a context menu. */
  onPreviewFile?: (relPath: string, projectId?: string) => void;
  /** Pinned row rendered above the folders/files, e.g. an `InstructionTreeRow` for the current scope. */
  instructionRow?: React.ReactNode;
  /** Pinned nodes rendered below `instructionRow` and above the folders/files, e.g. Skills/Agents/Hooks/MCP `TreeGroup`s for the current scope. */
  pinnedRows?: React.ReactNode;
  /** Root-level folders already registered as a `Project` swap "Usar como Project" for an "Abrir customizations do projeto" shortcut into that project. */
  workspaceRootPath?: string;
  projects?: ReadonlyArray<Project>;
  onOpenProject?: (projectId: string) => void;
  scopeProjectId?: string;
  /** Renders a Project's own INSTRUCTIONS row pinned above its children once its folder node is expanded in place — lets a Project's instruction be reached without "entering" it via `onOpenProject`. `depth` matches its children's own indent level (see `TreeNode`'s `pl: 1.5 + depth * 2`), so the row reads as nested under the Project folder rather than flush with it. */
  renderProjectInstructionRow?: (project: Project, depth: number) => React.ReactNode;
}

interface TreeNodeProps {
  entry: FileBrowserEntry;
  relPath: string;
  depth: number;
  onSelectFile: (relPath: string, projectId?: string) => void;
  onUseAsProject: (absolutePath: string) => void;
  onOpenPreviewMenu: (e: React.MouseEvent, target: PreviewTarget) => void;
  onError: (message: string) => void;
  workspaceRootPath?: string;
  projects?: ReadonlyArray<Project>;
  onOpenProject?: (projectId: string) => void;
  scopeProjectId?: string;
  renderProjectInstructionRow?: (project: Project, depth: number) => React.ReactNode;
}

function TreeNode({
  entry,
  relPath,
  depth,
  onSelectFile,
  onUseAsProject,
  onOpenPreviewMenu,
  onError,
  workspaceRootPath,
  projects,
  onOpenProject,
  scopeProjectId,
  renderProjectInstructionRow,
}: TreeNodeProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const resolveAbsolutePath = useResolveAbsolutePath();
  const isRootLevel = entry.kind === 'dir' && depth === 0 && !scopeProjectId;
  const matchedProject =
    isRootLevel && workspaceRootPath !== undefined
      ? projects?.find((p) => p.path === joinRootPath(workspaceRootPath, entry.name))
      : undefined;
  const canUseAsProject = isRootLevel && matchedProject === undefined;
  // A root-level folder already registered as a Project expands in place too,
  // browsing its own tree without leaving the workspace-root view — full
  // navigation into the Project (Skills/Agents/Instructions/Sessions) stays
  // behind the dedicated "Gerir instructions" shortcut further below. Every
  // other root-level folder stays flat, for now — only inside a Project's own
  // tree (scoped, or expanded in place here) can you drill into subfolders.
  const effectiveProjectId = scopeProjectId ?? matchedProject?.id;
  const canExpand = entry.kind === 'dir' && effectiveProjectId !== undefined;
  // A Project row's own listing is relative to ITS root ('') when expanded in
  // place from the unscoped workspace view — `relPath` there is
  // workspace-relative (e.g. "apps"), not what `project.listDir` expects.
  const listingPath = scopeProjectId ? relPath : matchedProject ? '' : relPath;
  const { data: children, isError: childrenError } = useDirListing(listingPath, {
    enabled: expanded && canExpand,
    ...(effectiveProjectId ? { projectId: effectiveProjectId } : {}),
  });

  const handleUseAsProject = async (): Promise<void> => {
    try {
      const absolutePath = await resolveAbsolutePath.mutateAsync(relPath);
      onUseAsProject(absolutePath);
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  return (
    <>
      <ListItemButton
        dense
        sx={{ pl: 1.5 + depth * 2 }}
        onClick={() => {
          if (canExpand) setExpanded((v) => !v);
          else if (entry.kind === 'file') onSelectFile(relPath, effectiveProjectId);
        }}
        onContextMenu={(e) => {
          if (entry.kind !== 'file') return;
          onOpenPreviewMenu(e, { relPath, ...(effectiveProjectId ? { projectId: effectiveProjectId } : {}) });
        }}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
          {/* Reserved uniformly so folder names line up whether or not a given row
              can expand — root-level Project folders now can, plain root-level
              folders still can't ("flat, for now"). */}
          {canExpand ? (
            <Icon glyph={expanded ? ChevronDown : ChevronRight} size={14} />
          ) : (
            <Box sx={{ width: 14 }} />
          )}
          <Icon glyph={entry.kind === 'dir' ? Folder : FileIcon} size={14} />
          <ListItemText
            primary={entry.name}
            slotProps={{ primary: { noWrap: true, sx: { fontSize: '0.85rem' } } }}
          />
          {matchedProject && <SessionStatusBadge anchor={{ kind: 'project', projectId: matchedProject.id }} />}
        </Stack>
        {canUseAsProject && (
          <Tooltip title="Usar como Project">
            <Box
              component="span"
              role="button"
              tabIndex={0}
              aria-label={`Usar ${entry.name} como Project`}
              data-testid={`tree-node-use-as-project-${entry.name}`}
              onClick={(e) => {
                e.stopPropagation();
                void handleUseAsProject();
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (e.key === ' ') e.preventDefault();
                e.stopPropagation();
                void handleUseAsProject();
              }}
              sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
            >
              <Icon glyph={FolderInput} size={14} />
            </Box>
          </Tooltip>
        )}
        {matchedProject && onOpenProject && (
          <Tooltip title="Abrir customizations do projeto">
            <Box
              component="span"
              role="button"
              tabIndex={0}
              aria-label={`Abrir customizations do projeto ${entry.name}`}
              data-testid={`tree-node-open-project-${entry.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenProject(matchedProject.id);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (e.key === ' ') e.preventDefault();
                e.stopPropagation();
                onOpenProject(matchedProject.id);
              }}
              sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
            >
              <Icon glyph={FolderOpen} size={14} />
            </Box>
          </Tooltip>
        )}
      </ListItemButton>
      {canExpand && (
        <Collapse in={expanded} unmountOnExit>
          {childrenError ? (
            <Typography
              variant="caption"
              color="error"
              data-testid={`tree-node-error-${entry.name}`}
              sx={{ display: 'block', pl: 1.5 + (depth + 1) * 2, py: 0.5 }}
            >
              Falha ao carregar
            </Typography>
          ) : (
            <List disablePadding>
              {matchedProject && renderProjectInstructionRow
                ? renderProjectInstructionRow(matchedProject, depth + 1)
                : null}
              {(children ?? []).map((child) => (
                <TreeNode
                  key={child.name}
                  entry={child}
                  relPath={listingPath ? `${listingPath}/${child.name}` : child.name}
                  depth={depth + 1}
                  onSelectFile={onSelectFile}
                  onUseAsProject={onUseAsProject}
                  onOpenPreviewMenu={onOpenPreviewMenu}
                  onError={onError}
                  {...(workspaceRootPath !== undefined ? { workspaceRootPath } : {})}
                  {...(projects !== undefined ? { projects } : {})}
                  {...(onOpenProject !== undefined ? { onOpenProject } : {})}
                  {...(effectiveProjectId ? { scopeProjectId: effectiveProjectId } : {})}
                  {...(renderProjectInstructionRow !== undefined ? { renderProjectInstructionRow } : {})}
                />
              ))}
            </List>
          )}
        </Collapse>
      )}
    </>
  );
}

export function FolderTree({
  onSelectFile,
  onUseAsProject,
  onPreviewFile,
  instructionRow,
  pinnedRows,
  workspaceRootPath,
  projects,
  onOpenProject,
  scopeProjectId,
  renderProjectInstructionRow,
}: FolderTreeProps): React.ReactElement {
  const { data: rootEntries, isError } = useDirListing('', {
    ...(scopeProjectId ? { projectId: scopeProjectId } : {}),
  });
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const previewMenu = useRowContextMenu<PreviewTarget>();
  /** The (unscoped) workspace root listing is folders-only, for now — matches the flat, no-depth behavior in TreeNode. */
  const visibleEntries = scopeProjectId ? rootEntries : rootEntries?.filter((entry) => entry.kind === 'dir');

  if (isError) {
    return (
      <Box data-testid="folder-tree-error" sx={{ p: 2 }}>
        <EmptyState
          glyph={FolderX}
          title="Não foi possível carregar a árvore de arquivos"
          description="Verifique as permissões da pasta e tente novamente."
          testId="folder-tree-error"
        />
      </Box>
    );
  }

  return (
    <>
      <List disablePadding data-testid="folder-tree">
        {instructionRow}
        {pinnedRows}
        {(visibleEntries ?? []).map((entry) => (
          <TreeNode
            key={entry.name}
            entry={entry}
            relPath={entry.name}
            depth={0}
            onSelectFile={onSelectFile}
            onUseAsProject={onUseAsProject}
            onOpenPreviewMenu={previewMenu.openMenu}
            onError={(message) => setToast({ variant: 'error', message })}
            {...(workspaceRootPath !== undefined ? { workspaceRootPath } : {})}
            {...(projects !== undefined ? { projects } : {})}
            {...(onOpenProject !== undefined ? { onOpenProject } : {})}
            {...(scopeProjectId ? { scopeProjectId } : {})}
            {...(renderProjectInstructionRow !== undefined ? { renderProjectInstructionRow } : {})}
          />
        ))}
      </List>
      <RowContextMenu
        state={previewMenu.state}
        onClose={previewMenu.closeMenu}
        onPreview={() => {
          if (previewMenu.state) onPreviewFile?.(previewMenu.state.target.relPath, previewMenu.state.target.projectId);
        }}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
