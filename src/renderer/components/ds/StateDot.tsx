import { Box } from '@mui/material';
import type { Severity } from '../../../shared/health.js';

export const SEVERITY_COLOR: Record<Severity, 'success.main' | 'warning.main' | 'error.main'> = {
  ok: 'success.main',
  warning: 'warning.main',
  error: 'error.main',
};

/** The colour of a Conectado / Em alerta / Com erro state; always next to its words, never alone. */
export function StateDot({ severity }: { severity: Severity }): React.ReactElement {
  return <Box component="span" aria-hidden sx={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, bgcolor: SEVERITY_COLOR[severity], display: 'inline-block' }} />;
}
