import { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { brand } from '../../shared/brand.js';

interface RecoveryScreenProps {
  /** Technical text for "Detalhes" and "Copiar detalhes": error, stack, process, time. */
  details: string;
  onReload: () => void;
}

/**
 * Replaces the blank window after a renderer crash or a React render error.
 * Terminal sessions live in the main process, so telling the user they keep
 * running is true. Nothing is sent anywhere: details are copied only on click.
 */
export function RecoveryScreen({ details, onReload }: RecoveryScreenProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard.writeText(details).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <Box
      component="main"
      role="alert"
      data-testid="recovery-screen"
      sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3, bgcolor: 'background.default' }}
    >
      <Box sx={{ maxWidth: 520, width: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="h6" component="h1">
          O {brand.displayName} encontrou um problema
        </Typography>
        <Typography color="text.secondary">Suas sessões nos terminais continuam rodando.</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button autoFocus variant="contained" data-testid="recovery-reload" onClick={onReload}>
            Recarregar
          </Button>
          <Button data-testid="recovery-copy" onClick={copy}>
            {copied ? 'Detalhes copiados' : 'Copiar detalhes'}
          </Button>
          <Button data-testid="recovery-details-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} sx={{ ml: 'auto' }}>
            {expanded ? 'Detalhes ▴' : 'Detalhes ▾'}
          </Button>
        </Box>
        {expanded && (
          <Box
            component="pre"
            data-testid="recovery-details"
            sx={{ m: 0, p: 1.5, borderRadius: 1, bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto' }}
          >
            {details}
          </Box>
        )}
      </Box>
    </Box>
  );
}
