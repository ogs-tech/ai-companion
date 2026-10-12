import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { House } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../ds/Icon.js';

interface WorkspaceBreadcrumbHeaderProps {
  workspaceName: string;
  /** True at Início (Global) — no workspace open, so there is no way "home" to offer. */
  isHome: boolean;
  path: string;
  onNavigateToWorkspace: () => void;
  actions?: ReactNode;
}

// Compact stand-in for ScreenHeader, scoped to this screen: Início and a
// workspace are a real two-level hierarchy (unlike the other ScreenHeader
// consumers, which all have a single flat title), so it reads better as a
// clickable breadcrumb than as a stacked kicker+title+subtitle block. Inside a
// workspace the trailing actions gain a way Home.
export function WorkspaceBreadcrumbHeader({
  workspaceName,
  isHome,
  path,
  onNavigateToWorkspace,
  actions,
}: WorkspaceBreadcrumbHeaderProps): React.ReactElement {
  return (
    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Typography component="h1" noWrap sx={{ fontSize: '0.85rem', fontWeight: 600, lineHeight: 1.4 }}>
            {workspaceName}
          </Typography>
          {isHome && (
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
      {(!isHome || actions !== undefined) && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
          {!isHome && (
            // Shown for the whole time a workspace is open, since it always
            // leads Home (same destination as the "Início" nav button).
            <Tooltip title="Início">
              <IconButton
                size="small"
                data-testid="workspace-breadcrumb-workspace-crumb"
                aria-label="Início"
                onClick={onNavigateToWorkspace}
              >
                <Icon glyph={House} size={16} />
              </IconButton>
            </Tooltip>
          )}
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
