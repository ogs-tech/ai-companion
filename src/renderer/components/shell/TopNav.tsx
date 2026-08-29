import { useSyncExternalStore } from 'react';
import { AppBar, Button, IconButton, Stack, Tab, Tabs, Toolbar, Tooltip, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight, Moon, Sun, Settings as SettingsGlyph } from 'lucide-react';
import { Logo } from '../../assets/Logo.js';
import { brand } from '../../../shared/brand.js';
import { Icon } from '../ds/Icon.js';
import { StatusPill, type StatusPillVariant } from '../ds/StatusPill.js';
import { useThemeMode } from '../../lib/theme-mode-context.js';
import {
  getWorkspaceHistorySnapshot,
  navigateWorkspaceHistory,
  subscribeWorkspaceHistory,
} from '../../lib/workspace-history-store.js';
import { NAV_AREAS, type Area } from './nav.js';

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

const SYNC_TOOLTIP: Record<'ok' | 'warning' | 'error', string> = {
  ok: 'Tudo sincronizado com Claude Code/Cursor.',
  warning: 'Alguns itens estão desincronizados — ver Diagnóstico.',
  error: 'Falha ao sincronizar — ver Diagnóstico.',
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
  const { canGoBack, canGoForward } = useSyncExternalStore(subscribeWorkspaceHistory, getWorkspaceHistorySnapshot);

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
              // MUI's Tab only calls Tabs' onChange when the clicked tab isn't
              // already selected — so an explicit onClick here (always fired)
              // is what lets re-clicking "Workspace" act as a "go home" jump
              // while already browsing one of its sub-screens.
              onClick={() => onSelectArea(a.area)}
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
          <Tooltip title="Voltar">
            {/* span wrapper keeps the tooltip working while the button is disabled */}
            <span>
              <IconButton
                data-testid="nav-history-back"
                onClick={() => void navigateWorkspaceHistory('back')}
                disabled={!canGoBack}
                size="small"
                sx={{ color: 'text.secondary' }}
                aria-label="Voltar"
              >
                <Icon glyph={ChevronLeft} size={18} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Avançar">
            <span>
              <IconButton
                data-testid="nav-history-forward"
                onClick={() => void navigateWorkspaceHistory('forward')}
                disabled={!canGoForward}
                size="small"
                sx={{ color: 'text.secondary' }}
                aria-label="Avançar"
              >
                <Icon glyph={ChevronRight} size={18} />
              </IconButton>
            </span>
          </Tooltip>
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

          {healthSeverity !== undefined && (
            <Tooltip title={SYNC_TOOLTIP[healthSeverity]}>
              <StatusPill
                variant={SYNC_VARIANT[healthSeverity]}
                label={SYNC_LABEL[healthSeverity]}
                testId="sync"
                onClick={() => onSelectArea('diagnostico')}
              />
            </Tooltip>
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
