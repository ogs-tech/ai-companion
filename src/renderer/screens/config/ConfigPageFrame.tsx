import { Box, Paper } from '@mui/material';
import { Kicker } from '../../components/ds/Kicker.js';

/** The shared chrome of a Config page: a centered column with one outlined section. */
export function ConfigPageFrame({ title, children, danger = false, testId }: { title: string; children: React.ReactNode; danger?: boolean; testId?: string }): React.ReactElement {
  return (
    <Box data-testid={testId} sx={{ p: 3, maxWidth: 760, mx: 'auto' }}>
      <Paper component="section" variant="outlined" sx={{ p: 3, ...(danger ? { borderColor: 'error.main' } : {}) }}>
        <Kicker component="h2">{title}</Kicker>
        {children}
      </Paper>
    </Box>
  );
}
