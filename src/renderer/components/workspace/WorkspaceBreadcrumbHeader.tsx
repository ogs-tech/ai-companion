import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { House } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../ds/Icon.js';

interface WorkspaceBreadcrumbHeaderProps {
  workspaceName: string;
  isDefaultWorkspace: boolean;
  path: string;
  onNavigateToWorkspace: () => void;
  actions?: ReactNode;
}

// Compact stand-in for ScreenHeader, scoped to this screen: the workspace/
// project relationship is a real two-level hierarchy (unlike the other
// ScreenHeader consumers, which all have a single flat title), so it reads
// better as a clickable breadcrumb than as a stacked kicker+title+subtitle
// block. The title itself never changes shape between workspace and Project
// scope — same name, same path line — only the trailing actions gain a way
// Home.
export function WorkspaceBreadcrumbHeader({
  workspaceName,
  isDefaultWorkspace,
  path,
  onNavigateToWorkspace,
  actions,
}: WorkspaceBreadcrumbHeaderProps): React.ReactElement {
  return (
    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Typography variant="h6" component="h1" noWrap>
            {workspaceName}
          </Typography>
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
      {(!isDefaultWorkspace || actions !== undefined) && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
          {!isDefaultWorkspace && (
            // Shown for the whole time you're on a non-default workspace —
            // with or without a Project additionally selected within it —
            // since it always leads Home (same destination as the "Início"
            // nav button), never just to this workspace's own view. A
            // non-default workspace is a stop along the way, not the
            // destination, whether or not you've also drilled into a Project.
            <Tooltip title="Início">
              <IconButton
                size="small"
                data-testid="workspace-breadcrumb-workspace-crumb"
                aria-label="Início"
                onClick={onNavigateToWorkspace}
              >
                <Icon glyph={House} size={18} />
              </IconButton>
            </Tooltip>
          )}
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
