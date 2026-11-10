import { useState } from 'react';
import { Folder } from 'lucide-react';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { CHANNELS, type ChannelId } from '../../../shared/channel.js';
import type { RunHarnessOption } from '../../hooks/use-run-channels.js';
import { ChannelMark } from '../ChannelMark.js';

interface NewSessionDialogProps {
  open: boolean;
  /** Absolute folders of the workspace, in order. */
  folders: readonly string[];
  aliases: Record<string, string>;
  /** Ticked when the dialog opens — the folder of the item the user is looking at. */
  defaultFolder?: string;
  /** Harnesses a session can start in. One (the default) hides the selector. */
  harnesses?: readonly RunHarnessOption[];
  onStart: (folders: string[], harness: ChannelId) => void;
  onCancel: () => void;
}

const CLAUDE_ONLY: readonly RunHarnessOption[] = [{ id: 'claude', available: true }];

/**
 * Which harness a new session runs in, and which of the workspace's folders it sees. Folders left unticked
 * are completely outside the session. One folder runs in it; two or more run
 * from a helper directory linking to exactly the ticked ones (no main folder).
 */
export function NewSessionDialog(props: NewSessionDialogProps): React.ReactElement {
  // Mounted only while open, so every opening starts from the default tick.
  return props.open ? <NewSessionForm {...props} /> : <></>;
}

function NewSessionForm({ folders, aliases, defaultFolder, harnesses = CLAUDE_ONLY, onStart, onCancel }: NewSessionDialogProps): React.ReactElement {
  const [ticked, setTicked] = useState<string[]>(() => (folders.length === 0 ? [] : [defaultFolder ?? (folders[0] as string)]));
  // Always opens on Claude (or the first option when Claude is off): the choice is per session, not remembered.
  const [harness, setHarness] = useState<ChannelId>(() => (harnesses.some((h) => h.id === 'claude') ? 'claude' : (harnesses[0]?.id ?? 'claude')));
  const chosen = harnesses.find((h) => h.id === harness);
  const pickFolders = folders.length > 1;

  const all = ticked.length === folders.length;
  const toggle = (folder: string): void =>
    setTicked((prev) => (prev.includes(folder) ? prev.filter((f) => f !== folder) : folders.filter((f) => prev.includes(f) || f === folder)));

  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth data-testid="new-session-dialog">
      <DialogTitle>Nova sessão</DialogTitle>
      <DialogContent>
        {harnesses.length > 1 && (
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={harness}
            onChange={(_, next: ChannelId | null) => next && setHarness(next)}
            aria-label="Canal da sessão"
            data-testid="new-session-harness"
            sx={{ mb: 2 }}
          >
            {harnesses.map((option) => (
              <Tooltip key={option.id} title={option.available ? '' : `${CHANNELS[option.id].displayName} não encontrado neste computador`}>
                <span style={{ flex: 1, display: 'flex' }}>
                  <ToggleButton
                    value={option.id}
                    disabled={!option.available}
                    data-testid={`new-session-harness-${option.id}`}
                    sx={{ flex: 1, gap: 1, textTransform: 'none' }}
                  >
                    <ChannelMark harness={option.id} size={16} />
                    {CHANNELS[option.id].displayName}
                  </ToggleButton>
                </span>
              </Tooltip>
            ))}
          </ToggleButtonGroup>
        )}
        {pickFolders && (<>
        <DialogContentText sx={{ mb: 1 }}>
          Escolha as pastas que a sessão enxerga. As que ficarem de fora ficam fora de verdade — nem como diretório extra.
        </DialogContentText>
        <FormControlLabel
          label="Todas as pastas"
          control={
            <Checkbox
              size="small"
              checked={all}
              indeterminate={!all && ticked.length > 0}
              onChange={() => setTicked(all ? [] : [...folders])}
              slotProps={{ input: { 'data-testid': 'new-session-all' } as React.InputHTMLAttributes<HTMLInputElement> }}
            />
          }
        />
        {folders.map((folder) => (
          <Box key={folder} sx={{ display: 'block', pl: 2 }}>
            <FormControlLabel
              label={
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                  <Folder size={14} aria-hidden />
                  <Typography component="span" variant="body2">{aliases[folder]}</Typography>
                </Box>
              }
              control={
                <Checkbox
                  size="small"
                  checked={ticked.includes(folder)}
                  onChange={() => toggle(folder)}
                  slotProps={{ input: { 'data-testid': `new-session-folder-${aliases[folder]}` } as React.InputHTMLAttributes<HTMLInputElement> }}
                />
              }
            />
          </Box>
        ))}
        </>)}
      </DialogContent>
      <DialogActions>
        <Button data-testid="new-session-cancel" onClick={onCancel}>Cancelar</Button>
        <Button data-testid="new-session-start" variant="contained" disabled={(pickFolders && ticked.length === 0) || !chosen?.available} onClick={() => onStart(ticked, harness)}>
          Iniciar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
