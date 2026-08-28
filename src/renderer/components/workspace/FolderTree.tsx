import { useState } from 'react';
import { Box, Collapse, List, ListItemButton, ListItemText, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronRight, ChevronDown, Folder, File as FileIcon, FolderInput, FolderUp, FolderX, NotebookPen } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { EmptyState } from '../ds/EmptyState.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useDirListing, useResolveAbsolutePath } from '../../hooks/use-file-browser.js';
import type { FileBrowserEntry } from '../../../shared/file-browser.js';
import type { Project } from '../../../shared/project.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A depth-0 folder's absolute path is always `<workspace root>/<folder name>`. */
function joinRootPath(root: string, name: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${name}`;
}

interface UpRowProps {
  testId: string;
  tooltip: string;
  onClick: () => void;
}

/** A ".." row — one level of "go back" in the tree's nesting, be it out of a Project or all the way home. */
function UpRow({ testId, tooltip, onClick }: UpRowProps): React.ReactElement {
  return (
    <Tooltip title={tooltip} placement="right">
      <ListItemButton
        dense
        data-testid={testId}
        aria-label={tooltip}
        onClick={onClick}
        sx={{ pl: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Icon glyph={FolderUp} size={14} />
          <ListItemText
            primary=".."
            slotProps={{ primary: { sx: { fontSize: '0.85rem', color: 'text.secondary' } } }}
          />
        </Stack>
      </ListItemButton>
    </Tooltip>
  );
}

interface FolderTreeProps {
  onSelectFile: (relPath: string) => void;
  onUseAsProject: (absolutePath: string) => void;
  /** Pinned row rendered above the folders/files, e.g. an `InstructionTreeRow` for the current scope. */
  instructionRow?: React.ReactNode;
  /** Pinned nodes rendered below `instructionRow` and above the folders/files, e.g. Skills/Agents/Hooks/MCP `TreeGroup`s for the current scope. */
  pinnedRows?: React.ReactNode;
  /** Root-level folders already registered as a `Project` swap "Usar como Project" for a "Gerir instructions" shortcut into that project. */
  workspaceRootPath?: string;
  projects?: ReadonlyArray<Project>;
  onManageProject?: (projectId: string) => void;
  scopeProjectId?: string;
  /** Called when the ".." row is clicked — only rendered while `scopeProjectId` is set, to step back out to the workspace-wide tree. */
  onNavigateUp?: () => void;
  /** Called when the ".." row is clicked — only rendered while NOT scoped to a Project, to step back out to Início (the global/Default workspace). */
  onNavigateHome?: () => void;
}

interface TreeNodeProps {
  entry: FileBrowserEntry;
  relPath: string;
  depth: number;
  onSelectFile: (relPath: string) => void;
  onUseAsProject: (absolutePath: string) => void;
  onError: (message: string) => void;
  workspaceRootPath?: string;
  projects?: ReadonlyArray<Project>;
  onManageProject?: (projectId: string) => void;
  scopeProjectId?: string;
}

function TreeNode({
  entry,
  relPath,
  depth,
  onSelectFile,
  onUseAsProject,
  onError,
  workspaceRootPath,
  projects,
  onManageProject,
  scopeProjectId,
}: TreeNodeProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  /** The workspace root listing is flat, for now — only a Project's own tree supports drilling into subfolders. */
  const canExpand = entry.kind === 'dir' && scopeProjectId !== undefined;
  const { data: children, isError: childrenError } = useDirListing(relPath, {
    enabled: expanded && canExpand,
    ...(scopeProjectId ? { projectId: scopeProjectId } : {}),
  });
  const resolveAbsolutePath = useResolveAbsolutePath();
  const isRootLevel = entry.kind === 'dir' && depth === 0 && !scopeProjectId;
  const matchedProject =
    isRootLevel && workspaceRootPath !== undefined
      ? projects?.find((p) => p.path === joinRootPath(workspaceRootPath, entry.name))
      : undefined;
  const canUseAsProject = isRootLevel && matchedProject === undefined;

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
          else if (matchedProject && onManageProject) onManageProject(matchedProject.id);
          else if (entry.kind === 'file') onSelectFile(relPath);
        }}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
          {/* The workspace-root listing is flat and folders-only — nothing there ever
              expands, so reserving chevron space would just misalign it against the
              flush-left "..", instruction, and management rows above it. */}
          {scopeProjectId !== undefined &&
            (canExpand ? (
              <Icon glyph={expanded ? ChevronDown : ChevronRight} size={14} />
            ) : (
              <Box sx={{ width: 14 }} />
            ))}
          <Icon glyph={entry.kind === 'dir' ? Folder : FileIcon} size={14} />
          <ListItemText
            primary={entry.name}
            slotProps={{ primary: { noWrap: true, sx: { fontSize: '0.85rem' } } }}
          />
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
        {matchedProject && onManageProject && (
          <Tooltip title="Gerir instructions do projeto">
            <Box
              component="span"
              role="button"
              tabIndex={0}
              aria-label={`Gerir instructions do projeto ${entry.name}`}
              data-testid={`tree-node-manage-instructions-${entry.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onManageProject(matchedProject.id);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (e.key === ' ') e.preventDefault();
                e.stopPropagation();
                onManageProject(matchedProject.id);
              }}
              sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
            >
              <Icon glyph={NotebookPen} size={14} />
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
              {(children ?? []).map((child) => (
                <TreeNode
                  key={child.name}
                  entry={child}
                  relPath={relPath ? `${relPath}/${child.name}` : child.name}
                  depth={depth + 1}
                  onSelectFile={onSelectFile}
                  onUseAsProject={onUseAsProject}
                  onError={onError}
                  {...(workspaceRootPath !== undefined ? { workspaceRootPath } : {})}
                  {...(projects !== undefined ? { projects } : {})}
                  {...(onManageProject !== undefined ? { onManageProject } : {})}
                  {...(scopeProjectId ? { scopeProjectId } : {})}
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
  instructionRow,
  pinnedRows,
  workspaceRootPath,
  projects,
  onManageProject,
  scopeProjectId,
  onNavigateUp,
  onNavigateHome,
}: FolderTreeProps): React.ReactElement {
  const { data: rootEntries, isError } = useDirListing('', {
    ...(scopeProjectId ? { projectId: scopeProjectId } : {}),
  });
  const [toast, setToast] = useState<ToastMessage | null>(null);
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
        {scopeProjectId && onNavigateUp && (
          <UpRow testId="tree-node-up" tooltip="Voltar para o workspace" onClick={onNavigateUp} />
        )}
        {!scopeProjectId && onNavigateHome && (
          <UpRow testId="tree-node-home" tooltip="Voltar para o Início (workspace global)" onClick={onNavigateHome} />
        )}
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
            onError={(message) => setToast({ variant: 'error', message })}
            {...(workspaceRootPath !== undefined ? { workspaceRootPath } : {})}
            {...(projects !== undefined ? { projects } : {})}
            {...(onManageProject !== undefined ? { onManageProject } : {})}
            {...(scopeProjectId ? { scopeProjectId } : {})}
          />
        ))}
      </List>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
