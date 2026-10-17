import { useState } from 'react';
import { Alert, Box, Button, Collapse } from '@mui/material';
import type { ErrorReport } from './use-git-actions.js';

interface GitErrorAlertProps {
  report: ErrorReport;
  onClose: () => void;
  /** Offered for a rejected push; omitted where a pull makes no sense. */
  onPullAndRetry?: () => void;
}

export function GitErrorAlert({ report, onClose, onPullAndRetry }: GitErrorAlertProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const hasDetails = report.stderr !== undefined || (report.files?.length ?? 0) > 0;
  return (
    <Alert
      severity="error"
      onClose={onClose}
      data-testid="git-error"
      sx={{ mx: 1.5, mt: 1, '& .MuiAlert-message': { minWidth: 0, flex: 1 } }}
    >
      <Box sx={{ wordBreak: 'break-word' }}>{report.message}</Box>
      {report.pushRejected && onPullAndRetry && (
        <Button
          size="small"
          color="inherit"
          sx={{ px: 0, mr: 1, minWidth: 0 }}
          onClick={() => {
            onClose();
            onPullAndRetry();
          }}
          data-testid="git-error-pull-retry"
        >
          Pull e tentar de novo
        </Button>
      )}
      {hasDetails && (
        <>
          <Button
            size="small"
            color="inherit"
            sx={{ px: 0, minWidth: 0 }}
            onClick={() => setOpen((v) => !v)}
            data-testid="git-error-details-toggle"
          >
            {open ? 'Ocultar detalhes' : 'Ver detalhes'}
          </Button>
          <Collapse in={open}>
            <Box
              component="pre"
              data-testid="git-error-details"
              sx={(theme) => ({
                m: 0,
                fontFamily: theme.ogs.fonts.mono,
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              })}
            >
              {[...(report.files ?? []), ...(report.stderr !== undefined ? [report.stderr] : [])].join('\n')}
            </Box>
          </Collapse>
        </>
      )}
    </Alert>
  );
}
