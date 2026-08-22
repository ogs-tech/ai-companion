import { Box, Typography, type Theme } from '@mui/material';

export type StatusPillVariant =
  | 'synced'
  | 'unsynced'
  | 'plugin'
  | 'claude-code'
  | 'error'
  | 'ok'
  | 'warning'
  | 'idle'
  | 'starting'
  | 'running'
  | 'exited';

interface StatusPillProps {
  variant: StatusPillVariant;
  label?: string;
  testId?: string;
}

function color(theme: Theme, variant: StatusPillVariant): string {
  switch (variant) {
    case 'synced':
    case 'ok':
    case 'running':
      return theme.palette.success.main;
    case 'unsynced':
    case 'warning':
    case 'starting':
      return theme.palette.warning.main;
    case 'plugin':
      return theme.palette.info.main;
    case 'claude-code':
    case 'idle':
    case 'exited':
      // Neutral slate: marks origin/provenance or an inactive state, not an
      // in-progress one — deliberately avoids the chromatic status roles
      // (blue 'plugin', amber 'warning', green 'ok', red 'error').
      return theme.ogs.slate;
    case 'error':
      return theme.palette.error.main;
  }
}

export function StatusPill({ variant, label, testId }: StatusPillProps): React.ReactElement {
  return (
    <Box
      {...(testId ? { 'data-testid': `status-pill-${testId}` } : {})}
      data-variant={variant}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1,
        py: 0.25,
        borderRadius: theme.ogs.radius.pill,
        border: `1px solid ${color(theme, variant)}`,
        color: color(theme, variant),
        bgcolor: 'transparent',
      })}
    >
      <Box
        component="span"
        sx={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: 'currentColor',
          // 'running' is the only variant meant to read as a live process —
          // the pulse is the one motion cue this pill ever needs.
          ...(variant === 'running' && {
            animation: 'statusPillPulse 1.6s ease-in-out infinite',
            '@keyframes statusPillPulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }),
        }}
      />
      <Typography
        component="span"
        sx={(theme) => ({
          fontFamily: theme.ogs.fonts.mono,
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'inherit',
        })}
      >
        {label ?? variant}
      </Typography>
    </Box>
  );
}
