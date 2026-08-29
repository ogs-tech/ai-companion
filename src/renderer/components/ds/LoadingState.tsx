import { Skeleton, Stack } from '@mui/material';

interface LoadingStateProps {
  kind: 'list' | 'card' | 'detail';
  testId?: string;
}

export function LoadingState({ kind, testId }: LoadingStateProps): React.ReactElement {
  const rows = kind === 'detail' ? 1 : 4;
  return (
    <Stack {...(testId ? { 'data-testid': `loading-state-${testId}` } : {})} spacing={1.5} sx={{ py: 2 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={kind === 'detail' ? 240 : 64} sx={(theme) => ({ borderRadius: `${theme.ogs.radius.md}px` })} />
      ))}
    </Stack>
  );
}
