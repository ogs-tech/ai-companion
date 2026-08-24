import { useState } from 'react';
import { Box, Button, Container, Divider, IconButton, List, ListItem, ListItemText, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { SquareTerminal, Trash2 } from 'lucide-react';
import { fonts } from '../../tokens.js';
import { Icon } from '../../components/ds/Icon.js';
import { Kicker } from '../../components/ds/Kicker.js';
import { ScreenHeader } from '../../components/ds/ScreenHeader.js';
import { FolderTree } from '../../components/workspace/FolderTree.js';
import { FilePreviewPane } from '../../components/workspace/FilePreviewPane.js';
import { SessionDialog } from '../../components/workspace/SessionDialog.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { useActiveWorkspace } from '../../hooks/use-workspaces.js';
import { useDeleteProject, useFindOrCreateProjectByPath, useProjects } from '../../hooks/use-projects.js';
import type { SessionAnchor } from '../../../shared/session.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function WorkspaceScreen(): React.ReactElement {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: projects = [] } = useProjects();
  const findOrCreateProject = useFindOrCreateProjectByPath();
  const deleteProject = useDeleteProject();

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sessionAnchor, setSessionAnchor] = useState<SessionAnchor | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const openSession = (anchor: SessionAnchor, title: string): void => {
    setSessionAnchor(anchor);
    setSessionTitle(title);
  };

  const handleDeleteProject = async (id: string): Promise<void> => {
    try {
      await deleteProject.mutateAsync(id);
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const handleUseAsProject = async (absolutePath: string): Promise<void> => {
    try {
      await findOrCreateProject.mutateAsync(absolutePath);
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  return (
    <Container component="main" data-testid="workspace-screen" maxWidth="lg" sx={{ py: 2.5 }}>
      <ScreenHeader kicker="Workspace" title={activeWorkspace?.name ?? '…'} subtitle={activeWorkspace?.rootPath ?? ''} />

      <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="subtitle2">{activeWorkspace?.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: fonts.mono }}>
            {activeWorkspace?.rootPath}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Icon glyph={SquareTerminal} size={16} />}
          data-testid="workspace-open-session"
          disabled={!activeWorkspace}
          onClick={() =>
            activeWorkspace && openSession({ kind: 'workspace', workspaceId: activeWorkspace.id }, activeWorkspace.name)
          }
        >
          Abrir sessão
        </Button>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Kicker>Projects</Kicker>
        <List dense disablePadding sx={{ mt: 1 }}>
          {projects.map((p) => (
            <ListItem
              key={p.id}
              divider
              secondaryAction={
                <Stack direction="row" spacing={0.5}>
                  <Tooltip title="Abrir sessão">
                    <IconButton
                      edge="end"
                      size="small"
                      data-testid={`project-open-session-${p.id}`}
                      onClick={() => openSession({ kind: 'project', projectId: p.id }, p.name)}
                    >
                      <Icon glyph={SquareTerminal} size={16} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Remover">
                    <IconButton
                      edge="end"
                      size="small"
                      data-testid={`project-delete-${p.id}`}
                      onClick={() => void handleDeleteProject(p.id)}
                    >
                      <Icon glyph={Trash2} size={16} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              }
            >
              <ListItemText
                primary={p.name}
                secondary={<Box component="code" sx={{ fontFamily: fonts.mono }}>{p.path}</Box>}
              />
            </ListItem>
          ))}
        </List>
      </Paper>

      <Paper variant="outlined" sx={{ p: 0, display: 'flex', minHeight: 420 }}>
        <Box sx={{ width: 320, borderRight: 1, borderColor: 'divider', overflowY: 'auto' }}>
          <FolderTree
            onSelectFile={setSelectedFile}
            onUseAsProject={(absolutePath) => void handleUseAsProject(absolutePath)}
          />
        </Box>
        <Divider orientation="vertical" flexItem />
        <Box sx={{ flexGrow: 1, p: 2, overflow: 'auto' }}>
          <FilePreviewPane path={selectedFile} />
        </Box>
      </Paper>

      <SessionDialog
        open={sessionAnchor !== null}
        anchor={sessionAnchor}
        title={sessionTitle}
        onClose={() => setSessionAnchor(null)}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Container>
  );
}
