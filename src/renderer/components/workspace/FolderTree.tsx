import { useState } from 'react';
import { Box, Collapse, List, ListItemButton, ListItemText, Stack, Tooltip } from '@mui/material';
import { ChevronRight, ChevronDown, Folder, File as FileIcon, FolderInput } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { useDirListing, useResolveAbsolutePath } from '../../hooks/use-file-browser.js';
import type { FileBrowserEntry } from '../../../shared/file-browser.js';

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
}

function TreeNode({ entry, relPath, depth, onSelectFile, onUseAsProject }: TreeNodeProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const { data: children } = useDirListing(relPath, { enabled: expanded });
  const resolveAbsolutePath = useResolveAbsolutePath();

  const handleUseAsProject = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    const absolutePath = await resolveAbsolutePath.mutateAsync(relPath);
    onUseAsProject(absolutePath);
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
              aria-label={`Usar ${entry.name} como Project`}
              data-testid={`tree-node-use-as-project-${entry.name}`}
              onClick={(e) => void handleUseAsProject(e)}
              sx={{ display: 'inline-flex', p: 0.5 }}
            >
              <Icon glyph={FolderInput} size={14} />
            </Box>
          </Tooltip>
        )}
      </ListItemButton>
      {entry.kind === 'dir' && (
        <Collapse in={expanded} unmountOnExit>
          <List disablePadding>
            {(children ?? []).map((child) => (
              <TreeNode
                key={child.name}
                entry={child}
                relPath={relPath ? `${relPath}/${child.name}` : child.name}
                depth={depth + 1}
                onSelectFile={onSelectFile}
                onUseAsProject={onUseAsProject}
              />
            ))}
          </List>
        </Collapse>
      )}
    </>
  );
}

export function FolderTree({ onSelectFile, onUseAsProject }: FolderTreeProps): React.ReactElement {
  const { data: rootEntries } = useDirListing('');

  return (
    <List disablePadding data-testid="folder-tree">
      {(rootEntries ?? []).map((entry) => (
        <TreeNode
          key={entry.name}
          entry={entry}
          relPath={entry.name}
          depth={0}
          onSelectFile={onSelectFile}
          onUseAsProject={onUseAsProject}
        />
      ))}
    </List>
  );
}
