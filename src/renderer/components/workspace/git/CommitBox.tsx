import { useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material';
import { GitErrorAlert } from './GitErrorAlert.js';
import { toReport, type ErrorReport } from './use-git-actions.js';

interface CommitBoxProps {
  stagedCount: number;
  busy: boolean;
  /** Resolves on success (the box then clears), rejects on failure (the message is kept). */
  onCommit: (message: string, amend: boolean) => Promise<void>;
  /** Resolves with a message generated from the staged diff; rejects with the reason it could not. */
  onGenerate: () => Promise<string>;
}

/**
 * Message field + "✦ Gerar" + "Commit" — ⌘/Ctrl+Enter submits. Amend lifts the
 * "something staged" requirement but disables Gerar: the staged diff is not
 * what an amend would commit. Generating only fills the field; it never commits.
 */
export function CommitBox({ stagedCount, busy, onCommit, onGenerate }: CommitBoxProps): React.ReactElement {
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [generateError, setGenerateError] = useState<ErrorReport | null>(null);
  const canCommit = !busy && !generating && message.trim().length > 0 && (amend || stagedCount > 0);
  const canGenerate = !busy && !generating && !amend && stagedCount > 0;

  const generate = (): void => {
    setConfirmReplace(false);
    setGenerateError(null);
    setGenerating(true);
    onGenerate().then(
      (text) => {
        setMessage(text);
        setGenerated(true);
        setGenerating(false);
      },
      (err: unknown) => {
        setGenerateError(toReport(err));
        setGenerating(false);
      },
    );
  };
  const requestGenerate = (): void => {
    if (message.trim().length > 0) setConfirmReplace(true);
    else generate();
  };

  const submit = (): void => {
    if (!canCommit) return;
    onCommit(message, amend).then(
      () => {
        setMessage('');
        setAmend(false);
        setGenerated(false);
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
        onChange={(e) => {
          setMessage(e.target.value);
          setConfirmReplace(false);
        }}
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
      {confirmReplace && (
        <Box data-testid="git-generate-confirm" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
          <Typography variant="caption" sx={{ flex: 1 }}>
            Substituir o texto atual pela mensagem gerada?
          </Typography>
          <Button size="small" color="warning" data-testid="git-generate-replace" onClick={generate} sx={{ textTransform: 'none', minWidth: 0 }}>
            Substituir
          </Button>
          <Button size="small" data-testid="git-generate-cancel" onClick={() => setConfirmReplace(false)} sx={{ textTransform: 'none', minWidth: 0 }}>
            Cancelar
          </Button>
        </Box>
      )}
      {generateError && <GitErrorAlert report={generateError} onClose={() => setGenerateError(null)} />}
      {stagedCount === 0 && !amend && (
        <Typography variant="caption" color="text.secondary" data-testid="git-generate-hint">
          Faça stage de ao menos um arquivo para gerar.
        </Typography>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
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
          disabled={!canGenerate}
          onClick={requestGenerate}
          data-testid="git-generate-btn"
          sx={{ textTransform: 'none', minWidth: 0, ml: 'auto' }}
        >
          {generating ? '◌ Gerando…' : generated ? '✦ Regerar' : '✦ Gerar'}
        </Button>
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
