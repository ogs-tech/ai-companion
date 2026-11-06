import { useState } from 'react';
import { Alert, Box, Button, Snackbar } from '@mui/material';

export type ToastVariant = 'success' | 'error';

export interface ToastMessage {
  variant: ToastVariant;
  message: string;
  /** A single inline action, e.g. "Desfazer" or "Tentar de novo". */
  action?: { label: string; onClick: () => void };
  /**
   * Technical error text. When present the toast is persistent (it stays until
   * dismissed) and offers "Detalhes" (expands this in place) and "Copiar
   * detalhes". Nothing leaves the app unless the user clicks the copy button.
   */
  details?: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
  durationMs?: number;
}

export function Toast({
  toast,
  onDismiss,
  durationMs = 4000,
}: ToastProps): React.ReactElement | null {
  const persistent = toast?.details !== undefined;
  return (
    <Snackbar
      open={toast !== null}
      autoHideDuration={persistent ? null : durationMs}
      // A persistent error only closes on its own X: clicking elsewhere must not hide it.
      onClose={(_event, reason) => {
        if (persistent && reason === 'clickaway') return;
        onDismiss();
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
    >
      {toast ? <ToastAlert key={toast.message} toast={toast} onDismiss={onDismiss} /> : undefined}
    </Snackbar>
  );
}

// Snackbar clones its child with a ref (transition + click-away need the DOM node), so the ref must reach the Alert.
function ToastAlert({ toast, onDismiss, ref }: { toast: ToastMessage; onDismiss: () => void; ref?: React.Ref<HTMLDivElement> }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { details } = toast;

  const copy = (): void => {
    if (details === undefined) return;
    void navigator.clipboard.writeText(details).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <Alert
      ref={ref}
      onClose={onDismiss}
      action={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {toast.action && (
            <Button color="inherit" size="small" data-testid="toast-action" onClick={toast.action.onClick}>
              {toast.action.label}
            </Button>
          )}
          {details !== undefined && (
            <Button
              color="inherit"
              size="small"
              data-testid="toast-details-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Detalhes ▴' : 'Detalhes ▾'}
            </Button>
          )}
        </Box>
      }
      severity={toast.variant}
      variant="filled"
      data-testid="toast"
      data-variant={toast.variant}
      sx={{ whiteSpace: 'pre-line', maxWidth: 480 }}
    >
      {toast.message}
      {expanded && details !== undefined && (
        <Box data-testid="toast-details" sx={{ mt: 1 }}>
          <Box
            component="pre"
            sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: 'rgba(0,0,0,0.25)', fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {details}
          </Box>
          <Button color="inherit" size="small" data-testid="toast-copy-details" onClick={copy} sx={{ mt: 0.5 }}>
            {copied ? 'Detalhes copiados' : 'Copiar detalhes'}
          </Button>
        </Box>
      )}
    </Alert>
  );
}
