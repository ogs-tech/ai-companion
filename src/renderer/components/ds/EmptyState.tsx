import { Box, Stack, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.js';

interface EmptyStateProps {
  glyph: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  cta?: ReactNode;
  testId?: string;
}

export function EmptyState({ glyph, title, description, cta, testId }: EmptyStateProps): React.ReactElement {
  return (
    <Stack
      {...(testId ? { 'data-testid': `empty-state-${testId}` } : {})}
      spacing={1.5}
      sx={(theme) => ({
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: 8,
        px: 3,
        border: `1px dashed ${theme.palette.divider}`,
        borderRadius: `${theme.ogs.radius.md}px`,
        color: 'text.secondary',
      })}
    >
      <Box sx={{ color: 'text.secondary' }}>
        <Icon glyph={glyph} size={28} aria-hidden />
      </Box>
      <Typography variant="h6" color="text.primary">{title}</Typography>
      {description !== undefined && (
        <Typography variant="body2" sx={{ maxWidth: 420 }}>{description}</Typography>
      )}
      {cta !== undefined && <Box sx={{ mt: 1 }}>{cta}</Box>}
    </Stack>
  );
}
