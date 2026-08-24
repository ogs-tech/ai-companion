import { useState } from 'react';
import { Box, Collapse, List, ListItemButton, ListItemText, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronRight, ChevronDown, Folder, File as FileIcon, FolderInput, FolderX } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { EmptyState } from '../ds/EmptyState.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useDirListing, useResolveAbsolutePath } from '../../hooks/use-file-browser.js';
import type { FileBrowserEntry } from '../../../shared/file-browser.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface FolderTreeProps {
  onSelectFile: (relPath: string) => void;
  onUseAsProject: (absolutePath: string) => void;
}

interface TreeNodeProps {
  entry: FileBrowserEntry;
  relPath: string;
  depth: number;
  onSelectFile: (relPath: string) => void;
  onUseAsProject: (absolutePath: string) => void;
  onError: (message: string) => void;
}

function TreeNode({ entry, relPath, depth, onSelectFile, onUseAsProject, onError }: TreeNodeProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const { data: children, isError: childrenError } = useDirListing(relPath, { enabled: expanded });
  const resolveAbsolutePath = useResolveAbsolutePath();

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
        onClick={() => (entry.kind === 'dir' ? setExpanded((v) => !v) : onSelectFile(relPath))}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
          {entry.kind === 'dir' ? (
            <Icon glyph={expanded ? ChevronDown : ChevronRight} size={14} />
          ) : (
            <Box sx={{ width: 14 }} />
          )}
          <Icon glyph={entry.kind === 'dir' ? Folder : FileIcon} size={14} />
          <ListItemText
            primary={entry.name}
            slotProps={{ primary: { noWrap: true, sx: { fontSize: '0.85rem' } } }}
          />
        </Stack>
        {entry.kind === 'dir' && (
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
      </ListItemButton>
      {entry.kind === 'dir' && (
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
                />
              ))}
            </List>
          )}
        </Collapse>
      )}
    </>
  );
}

export function FolderTree({ onSelectFile, onUseAsProject }: FolderTreeProps): React.ReactElement {
  const { data: rootEntries, isError } = useDirListing('');
  const [toast, setToast] = useState<ToastMessage | null>(null);

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
        {(rootEntries ?? []).map((entry) => (
          <TreeNode
            key={entry.name}
            entry={entry}
            relPath={entry.name}
            depth={0}
            onSelectFile={onSelectFile}
            onUseAsProject={onUseAsProject}
            onError={(message) => setToast({ variant: 'error', message })}
          />
        ))}
      </List>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
