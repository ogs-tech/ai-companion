import { useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, TextField } from '@mui/material';

interface CommitBoxProps {
  stagedCount: number;
  busy: boolean;
  /** Resolves on success (the box then clears), rejects on failure (the message is kept). */
  onCommit: (message: string, amend: boolean) => Promise<void>;
}

/** Message field + "Commit" — ⌘/Ctrl+Enter submits. Amend lifts the "something staged" requirement. */
export function CommitBox({ stagedCount, busy, onCommit }: CommitBoxProps): React.ReactElement {
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const canCommit = !busy && message.trim().length > 0 && (amend || stagedCount > 0);

  const submit = (): void => {
    if (!canCommit) return;
    onCommit(message, amend).then(
      () => {
        setMessage('');
        setAmend(false);
      },
      () => undefined, // reported by the caller; keep the message for a retry
    );
  };

  return (
    <Box sx={{ px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <TextField
        size="small"
        multiline
        minRows={2}
        maxRows={8}
        placeholder="Mensagem do commit (⌘↵ para commitar)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        slotProps={{
          htmlInput: { 'data-testid': 'git-commit-message', 'aria-label': 'Mensagem do commit' },
        }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={amend}
              onChange={(e) => setAmend(e.target.checked)}
              slotProps={{
                input: {
                  'data-testid': 'git-commit-amend',
                } as React.InputHTMLAttributes<HTMLInputElement>,
              }}
            />
          }
          label="Amend"
          slotProps={{ typography: { variant: 'caption' } }}
        />
        <Button
          size="small"
          variant="contained"
          disabled={!canCommit}
          onClick={submit}
          data-testid="git-commit-btn"
        >
          {amend ? 'Amend' : stagedCount > 0 ? `Commit (${stagedCount})` : 'Commit'}
        </Button>
      </Box>
    </Box>
  );
}
