import { Box } from '@mui/material';

/** `synced` = on disk for every enabled harness; `pending` = missing/stale; `detected` = found in a harness's own files, not yet applied; `missing` = nothing created yet. */
export type SyncDotState = 'synced' | 'pending' | 'detected' | 'missing';

const LABEL: Record<SyncDotState, string> = {
  synced: 'Sincronizado',
  pending: 'Pendente de sincronização',
  detected: 'Detectado, ainda não aplicado',
  missing: 'Não criada',
};

interface SyncDotProps {
  state: SyncDotState;
}

/**
 * The one status indicator of a customization row: filled green / amber; a plain grey ring when
 * nothing exists yet; a dashed blue ring for detected ("something is there that is not yours yet" —
 * deliberately not a radio button).
 */
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
        if (state === 'missing') return { ...base, border: `1.5px solid ${theme.palette.text.disabled}` };
        return { ...base, border: `1.5px dashed ${theme.palette.info.main}` };
      }}
    />
  );
}
