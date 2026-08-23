import { useState } from 'react';
import { Box, Button, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { callIpc } from '../../lib/ipc.js';
import {
  useActiveWorkspace,
  useCreateWorkspace,
  useDeleteWorkspace,
  useSwitchWorkspace,
  useWorkspaces,
} from '../../hooks/use-workspaces.js';

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function WorkspaceSwitcher(): React.ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { data: workspaces = [] } = useWorkspaces();
  const { data: active } = useActiveWorkspace();
  const switchWorkspace = useSwitchWorkspace();
  const createWorkspace = useCreateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();

  const close = (): void => setAnchor(null);

  const handleNew = async (): Promise<void> => {
    close();
    const picked = await callIpc<{ canceled: boolean; path?: string }>('dialog.selectFolder', {});
    if (picked.canceled || !picked.path) return;
    await createWorkspace.mutateAsync({ name: basename(picked.path), rootPath: picked.path });
  };

  return (
    <Box>
      <Button
        data-testid="workspace-switcher-trigger"
        onClick={(e) => setAnchor(e.currentTarget)}
        color="inherit"
        size="small"
        endIcon={<Icon glyph={ChevronDown} size={14} />}
      >
        {active?.name ?? '…'}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        {workspaces
          .filter((w) => w.id !== active?.id)
          .map((w) => (
            <MenuItem
              key={w.id}
              data-testid={`workspace-switch-${w.id}`}
              onClick={() => {
                close();
                void switchWorkspace.mutateAsync(w.id);
              }}
            >
              <ListItemText primary={w.name} secondary={w.rootPath} />
              <Box
                component="span"
                data-testid={`workspace-delete-${w.id}`}
                role="button"
                aria-label={`Excluir ${w.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  void deleteWorkspace.mutateAsync(w.id);
                }}
                sx={{ display: 'inline-flex', ml: 1, cursor: 'pointer' }}
              >
                <Icon glyph={Trash2} size={14} />
              </Box>
            </MenuItem>
          ))}
        <MenuItem data-testid="workspace-new" onClick={() => void handleNew()}>
          <Icon glyph={Plus} size={14} />
          <Typography sx={{ ml: 1 }}>Novo workspace</Typography>
        </MenuItem>
      </Menu>
    </Box>
  );
}
