import { Box } from '@mui/material';

/** `synced` = on disk for every enabled harness; `pending` = missing/stale; `detected` = found in a harness's own files, not yet applied. */
export type SyncDotState = 'synced' | 'pending' | 'detected';

const LABEL: Record<SyncDotState, string> = {
  synced: 'Sincronizado',
  pending: 'Pendente de sincronização',
  detected: 'Detectado, ainda não aplicado',
};

interface SyncDotProps {
  state: SyncDotState;
}

/** The one status indicator of a customization row: filled green / amber, or a blue ring with a dot for detected. */
export function SyncDot({ state }: SyncDotProps): React.ReactElement {
  return (
    <Box
      role="img"
      aria-label={LABEL[state]}
      title={LABEL[state]}
      data-testid="sync-dot"
      data-state={state}
      sx={(theme) => {
        const base = { width: 8, height: 8, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box' } as const;
        if (state === 'synced') return { ...base, bgcolor: theme.palette.success.main };
        if (state === 'pending') return { ...base, bgcolor: theme.palette.warning.main };
        return {
          ...base,
          border: `1.5px solid ${theme.palette.info.main}`,
          background: `radial-gradient(circle, ${theme.palette.info.main} 0 1.5px, transparent 2px)`,
        };
      }}
    />
  );
}
