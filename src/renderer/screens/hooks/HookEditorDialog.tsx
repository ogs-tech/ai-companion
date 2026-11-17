import { useState } from 'react';
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, Stack, TextField,
} from '@mui/material';
import { useSaveHook, type Hook, type HookInput, type HookScope } from '../../hooks/use-hooks.js';
import { ChannelSyncSection } from '../../components/ds/ChannelSyncSection.js';
import { entityUrn } from '../../../shared/entity.js';
import { SUPPORTED_HOOK_EVENTS } from '../../../shared/hook-events.js';
import type { HookHandler } from '../../lib/describe-hook-handler.js';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: Hook;
  scope: HookScope;
  onClose: () => void;
  onSaved: (hook: Hook) => void;
}

/** Seconds as typed; empty = no timeout. Anything else that isn't a positive integer is invalid. */
function parseTimeout(raw: string): number | undefined | 'invalid' {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 'invalid';
}

/**
 * One hook: event, matcher, the command it runs, an optional timeout and whether it is on. Same shape as
 * `McpEditorDialog`; in edit mode it also shows where each channel receives the hook. A non-command handler
 * (http, prompt, …) is kept as is — only its event, matcher and switch are editable here.
 */
export function HookEditorDialog({ open, mode, initial, scope, onClose, onSaved }: Props): React.ReactElement {
  const save = useSaveHook();
  const isCommand = (initial?.handler.type ?? 'command') === 'command';
  const [event, setEvent] = useState(initial?.event ?? '');
  const [matcher, setMatcher] = useState(initial?.matcher ?? '');
  const [command, setCommand] = useState(initial?.handler.command ?? '');
  const [timeout, setTimeoutText] = useState(initial?.handler.timeout !== undefined ? String(initial.handler.timeout) : '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  const parsedTimeout = parseTimeout(timeout);
  const canSave = event !== '' && (!isCommand || command.trim() !== '') && parsedTimeout !== 'invalid' && !save.isPending;

  const submit = (): void => {
    if (!canSave) return;
    const base: Record<string, unknown> = { ...(initial?.handler ?? { type: 'command' }) };
    if (isCommand) {
      base['command'] = command.trim();
      if (parsedTimeout === undefined) delete base['timeout'];
      else base['timeout'] = parsedTimeout;
    }
    const hook: HookInput = {
      ...(initial !== undefined ? { id: initial.id } : {}),
      event,
      ...(matcher.trim() !== '' ? { matcher: matcher.trim() } : {}),
      handler: base as unknown as HookHandler,
      enabled,
    };
    save.mutate({ hook, scope }, { onSuccess: (result) => { onSaved(result.hook); onClose(); } });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="hook-editor-dialog">
      <DialogTitle>{mode === 'create' ? 'New hook' : 'Edit hook'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Event" data-testid="hook-editor-event" value={event} onChange={(e) => setEvent(e.target.value)}>
            {SUPPORTED_HOOK_EVENTS.map((name) => (
              <MenuItem key={name} value={name}>{name}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Matcher" data-testid="hook-editor-matcher" value={matcher} onChange={(e) => setMatcher(e.target.value)}
            helperText="Ferramentas, separadas por | (ex.: Bash|Edit). Vazio = todas."
          />
          {isCommand && (
            <>
              <TextField label="Command" data-testid="hook-editor-command" value={command} onChange={(e) => setCommand(e.target.value)} />
              <TextField
                label="Timeout (s)" data-testid="hook-editor-timeout" value={timeout} onChange={(e) => setTimeoutText(e.target.value)}
                error={parsedTimeout === 'invalid'} helperText={parsedTimeout === 'invalid' ? 'Use um número inteiro de segundos.' : 'Opcional.'}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              />
            </>
          )}
          <FormControlLabel
            data-testid="hook-editor-enabled"
            control={<Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
            label="Ativo"
          />
        </Stack>
        {save.isError && <Alert severity="error" sx={{ mt: 2 }}>{save.error.message}</Alert>}
        {mode === 'edit' && initial !== undefined && <ChannelSyncSection urn={entityUrn('hook', initial.id)} entityEnabled={initial.enabled !== false} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" data-testid="hook-editor-save" onClick={submit} disabled={!canSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
