import { useSyncExternalStore } from 'react';
import { AppBar, Button, IconButton, Stack, Toolbar, Tooltip, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight, Globe, Moon, Sun, Settings as SettingsGlyph } from 'lucide-react';
import { Logo } from '../../assets/Logo.js';
import { brand } from '../../../shared/brand.js';
import { Icon } from '../ds/Icon.js';
import { StatusPill, type StatusPillVariant } from '../ds/StatusPill.js';
import { useThemeMode } from '../../lib/theme-mode-context.js';
import { useAreaNavigation } from '../../hooks/use-area-navigation.js';
import {
  getWorkspaceHistorySnapshot,
  navigateWorkspaceHistory,
  subscribeWorkspaceHistory,
} from '../../lib/workspace-history-store.js';
import { openManualTab } from '../../lib/browser-tabs-store.js';

interface TopNavProps {
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
  onOpenSettings,
  onOpenCommandPalette,
  healthSeverity,
}: TopNavProps): React.ReactElement {
  const { resolved, setTheme } = useThemeMode();
  const isDark = resolved === 'dark';
  const navigate = useAreaNavigation();
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

        {/* Right cluster — primary navigation now lives in the Explorer
            Panel's pinned rows (Default workspace), not here. */}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', ml: 'auto' }}>
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
                onClick={() => navigate('diagnostico')}
              />
            </Tooltip>
          )}

          <Tooltip title="Abrir navegador">
            <IconButton
              data-testid="nav-browser-toggle"
              onClick={() => void openManualTab()}
              size="small"
              sx={{ color: 'text.secondary' }}
              aria-label="Abrir navegador"
            >
              <Icon glyph={Globe} size={18} />
            </IconButton>
          </Tooltip>

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
