import { AppBar, Button, IconButton, Stack, Tab, Tabs, Toolbar, Tooltip, Typography } from '@mui/material';
import { Moon, Sun, Settings as SettingsGlyph } from 'lucide-react';
import { Logo } from '../../assets/Logo.js';
import { brand } from '../../../shared/brand.js';
import { Icon } from '../ds/Icon.js';
import { StatusPill, type StatusPillVariant } from '../ds/StatusPill.js';
import { useThemeMode } from '../../lib/theme-mode-context.js';
import { NAV_AREAS, type Area } from './nav.js';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';

interface TopNavProps {
  active: Area;
  onSelectArea: (area: Area) => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  healthSeverity?: 'ok' | 'warning' | 'error';
}

const SYNC_VARIANT: Record<'ok' | 'warning' | 'error', StatusPillVariant> = {
  ok: 'synced',
  warning: 'unsynced',
  error: 'error',
};

const SYNC_LABEL: Record<'ok' | 'warning' | 'error', string> = {
  ok: 'sincronizado',
  warning: 'atenção',
  error: 'erro',
};

export function TopNav({
  active,
  onSelectArea,
  onOpenSettings,
  onOpenCommandPalette,
  healthSeverity,
}: TopNavProps): React.ReactElement {
  const { resolved, setTheme } = useThemeMode();
  const isDark = resolved === 'dark';

  return (
    <AppBar
      position="sticky"
      elevation={0}
      color="default"
      sx={(theme) => ({
        bgcolor: 'background.paper',
        borderBottom: `1px solid ${theme.palette.divider}`,
      })}
    >
      <Toolbar sx={{ gap: 2 }}>
        {/* Brand — the "OGS · TECNOLOGIA BRASIL" line now lives in AppFooter. */}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.primary' }}>
          <Logo />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1 }}>
            {brand.displayName}
          </Typography>
        </Stack>

        {/* Primary tabs. The active marker is a CSS underline on the selected
            Tab — not MUI's measured floating indicator, which mis-measured on
            font-load/reflow and could fail to slide back (e.g. to Início). */}
        <Tabs
          value={active}
          onChange={(_, v) => onSelectArea(v as Area)}
          textColor="inherit"
          slotProps={{ indicator: { sx: { display: 'none' } } }}
          sx={{ ml: 2, flexGrow: 1, minHeight: 'auto' }}
        >
          {NAV_AREAS.map((a) => (
            <Tab
              key={a.area}
              value={a.area}
              label={a.label}
              data-testid={`nav-${a.area}`}
              icon={<Icon glyph={a.glyph} size={16} />}
              iconPosition="start"
              sx={(theme) => ({
                minHeight: 56,
                opacity: 1,
                color: 'text.secondary',
                '&.Mui-selected': {
                  color: 'text.primary',
                  boxShadow: `inset 0 -2px 0 ${theme.palette.info.main}`,
                },
              })}
            />
          ))}
        </Tabs>

        {/* Right cluster */}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Tooltip title="Buscar e navegar (⌘K)">
            <Button
              data-testid="command-palette-trigger"
              onClick={onOpenCommandPalette}
              color="inherit"
              variant="outlined"
              size="small"
            >
              ⌘K
            </Button>
          </Tooltip>

          <WorkspaceSwitcher />

          {healthSeverity !== undefined && (
            <StatusPill
              variant={SYNC_VARIANT[healthSeverity]}
              label={SYNC_LABEL[healthSeverity]}
              testId="sync"
            />
          )}

          <Tooltip title={isDark ? 'Tema claro' : 'Tema escuro'}>
            <IconButton
              data-testid="theme-toggle"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              size="small"
              sx={{ color: 'text.secondary' }}
              aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
            >
              <Icon glyph={isDark ? Sun : Moon} size={18} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Configurações">
            <IconButton
              data-testid="nav-settings"
              onClick={onOpenSettings}
              size="small"
              sx={{ color: 'text.secondary' }}
              aria-label="Configurações"
            >
              <Icon glyph={SettingsGlyph} size={18} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
