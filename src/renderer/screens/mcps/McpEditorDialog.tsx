import { useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Stack, TextField,
} from '@mui/material';
import { useSaveMcp } from '../../hooks/use-mcp-mutations.js';
import { ChannelSyncSection } from '../../components/ds/ChannelSyncSection.js';
import { entityUrn } from '../../../shared/entity.js';
import type { McpServer, McpServerInput, McpTransport } from '../../../shared/mcp.js';

type CreateScope = 'global' | 'project-local' | 'project-shared';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: McpServer;
  onClose: () => void;
}

// Preserves passthrough fields (args/env/headers/timeout/…) from the existing
// def, swapping only the transport-primary key. Prevents data loss on edit.
export function buildDef(
  base: Record<string, unknown>,
  transport: McpTransport,
  command: string,
  url: string,
): Record<string, unknown> {
  const def: Record<string, unknown> = { ...base };
  if (transport === 'stdio') {
    delete def['type'];
    delete def['url'];
    delete def['headers'];
    def['command'] = command;
  } else {
    delete def['command'];
    delete def['args'];
    delete def['env'];
    def['type'] = transport;
    def['url'] = url;
  }
  return def;
}

export function McpEditorDialog({ open, mode, initial, onClose }: Props): React.ReactElement {
  const save = useSaveMcp();
  const [name, setName] = useState(initial?.name ?? '');
  const [scope, setScope] = useState<CreateScope>(
    (initial?.scope as CreateScope) ?? 'global',
  );
  const [repoPath, setRepoPath] = useState(initial?.repoPath ?? '');
  const [transport, setTransport] = useState<McpTransport>(initial?.transport ?? 'stdio');
  const [command, setCommand] = useState(String(initial?.def?.['command'] ?? ''));
  const [url, setUrl] = useState(String(initial?.def?.['url'] ?? ''));

  const submit = (): void => {
    const server: McpServerInput = {
      name,
      scope,
      def: buildDef(initial?.def ?? {}, transport, command, url),
      ...(scope !== 'global' ? { repoPath } : {}),
      ...(initial?.id !== undefined ? { id: initial.id } : {}),
    };
    save.mutate(
      { server, isCreate: mode === 'create' },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{mode === 'create' ? 'New MCP server' : 'Edit MCP server'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Name" data-testid="mcp-name-input" value={name}
            onChange={(e) => setName(e.target.value)} disabled={mode === 'edit'}
          />
          <TextField
            select label="Scope" data-testid="mcp-scope-input" value={scope}
            onChange={(e) => setScope(e.target.value as CreateScope)} disabled={mode === 'edit'}
          >
            <MenuItem value="global">Personal (global)</MenuItem>
            <MenuItem value="project-local">Project (local)</MenuItem>
            <MenuItem value="project-shared">Project (shared / .mcp.json)</MenuItem>
          </TextField>
          {scope !== 'global' && (
            <TextField
              label="Repo path" data-testid="mcp-repo-input" value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
            />
          )}
          <TextField
            select label="Transport" data-testid="mcp-transport-input" value={transport}
            onChange={(e) => setTransport(e.target.value as McpTransport)}
          >
            <MenuItem value="stdio">stdio</MenuItem>
            <MenuItem value="http">http</MenuItem>
            <MenuItem value="sse">sse</MenuItem>
          </TextField>
          {transport === 'stdio' ? (
            <TextField
              label="Command" data-testid="mcp-command-input" value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          ) : (
            <TextField
              label="URL" data-testid="mcp-url-input" value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
        </Stack>
        {mode === 'edit' && initial !== undefined && <ChannelSyncSection urn={entityUrn('mcp', initial.name)} entityEnabled={initial.enabled} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" data-testid="mcp-save" onClick={submit} disabled={save.isPending || name.trim().length === 0}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
