import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface WorkspaceBreadcrumbHeaderProps {
  workspaceName: string;
  isDefaultWorkspace: boolean;
  projectName?: string;
  path: string;
  onNavigateToWorkspace: () => void;
  actions?: ReactNode;
}

// Compact stand-in for ScreenHeader, scoped to this screen: the workspace/
// project relationship is a real two-level hierarchy (unlike the other
// ScreenHeader consumers, which all have a single flat title), so it reads
// better as a clickable breadcrumb than as a stacked kicker+title+subtitle
// block. Also gives project scope a way back to the workspace from the
// header itself, alongside the existing "up" row inside the file tree.
export function WorkspaceBreadcrumbHeader({
  workspaceName,
  isDefaultWorkspace,
  projectName,
  path,
  onNavigateToWorkspace,
  actions,
}: WorkspaceBreadcrumbHeaderProps): React.ReactElement {
  return (
    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          {projectName !== undefined ? (
            <>
              <Typography
                component="button"
                type="button"
                onClick={onNavigateToWorkspace}
                data-testid="workspace-breadcrumb-workspace-crumb"
                noWrap
                sx={{
                  font: 'inherit',
                  border: 0,
                  background: 'none',
                  p: 0,
                  cursor: 'pointer',
                  color: 'text.secondary',
                  flexShrink: 1,
                  minWidth: 0,
                  '&:hover': { color: 'text.primary', textDecoration: 'underline' },
                }}
                variant="h6"
              >
                {workspaceName}
              </Typography>
              <Typography variant="h6" color="text.disabled" aria-hidden="true" sx={{ flexShrink: 0 }}>
                ›
              </Typography>
              <Typography variant="h6" component="h1" noWrap sx={{ minWidth: 0 }}>
                {projectName}
              </Typography>
            </>
          ) : (
            <Typography variant="h6" component="h1" noWrap>
              {workspaceName}
            </Typography>
          )}
          {isDefaultWorkspace && (
            <Chip size="small" variant="outlined" label="Global" sx={{ height: 18, fontSize: '0.6875rem' }} />
          )}
        </Stack>
        <Tooltip title={path}>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={(theme) => ({ display: 'block', fontFamily: theme.ogs.fonts.mono })}
          >
            {path}
          </Typography>
        </Tooltip>
      </Box>
      {actions !== undefined && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
