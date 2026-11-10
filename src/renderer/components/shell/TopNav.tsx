import { useSyncExternalStore } from 'react';
import { AppBar, ButtonBase, Divider, IconButton, Stack, Toolbar, Tooltip, Typography } from '@mui/material';
import {
  ChevronLeft, ChevronRight, PanelLeft, PanelRight, Search, Settings as SettingsGlyph,
} from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { shortcutFor } from '../../lib/shortcut-labels.js';
import {
  getWorkspaceHistorySnapshot,
  navigateWorkspaceHistory,
  subscribeWorkspaceHistory,
} from '../../lib/workspace-history-store.js';
import {
  getWorkspacePanelsSnapshot,
  subscribeWorkspacePanels,
  toggleWorkspacePanel,
} from '../../lib/workspace-shell-store.js';
import { openConfig } from '../../lib/workspace-area-store.js';

interface TopNavProps {
  onOpenCommandPalette: () => void;
}

export function TopNav({ onOpenCommandPalette }: TopNavProps): React.ReactElement {
  const paletteShortcut = shortcutFor('command-palette') ?? '';
  const { canGoBack, canGoForward } = useSyncExternalStore(subscribeWorkspaceHistory, getWorkspaceHistorySnapshot);
  const { explorerCollapsed, controlCollapsed } = useSyncExternalStore(subscribeWorkspacePanels, getWorkspacePanelsSnapshot);
  const explorerLabel = explorerCollapsed ? 'Mostrar painel esquerdo' : 'Ocultar painel esquerdo';
  const controlLabel = controlCollapsed ? 'Mostrar painel direito' : 'Ocultar painel direito';

  return (
    // Canvas-coloured and borderless: the bar reads as part of the canvas, and
    // the workspace cards below it start the hairline structure.
    // `border: 0` cancels the outlined border every Paper (AppBar included) inherits from the theme's MuiPaper defaultProps.
    <AppBar position="sticky" elevation={0} color="default" sx={{ bgcolor: 'background.default', border: 0 }}>
      {/* Local 40px override — the global MuiToolbar 56 still serves EntityDataGrid. */}
      <Toolbar sx={{ gap: 1, minHeight: { xs: 40, sm: 40 }, px: { xs: 1.5, sm: 1.5 } }}>
        <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
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
        </Stack>

        {/* Search-field-shaped ⌘K trigger — same onClick, it only looks like an input. */}
        <ButtonBase
          data-testid="command-palette-trigger"
          onClick={onOpenCommandPalette}
          aria-label={`Buscar e navegar (${paletteShortcut})`}
          sx={(theme) => ({
            mx: 'auto',
            width: 260,
            maxWidth: '40%',
            height: 26,
            px: 1.25,
            justifyContent: 'space-between',
            gap: 1,
            bgcolor: 'background.paper',
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: `${theme.ogs.radius.sm}px`,
            color: 'text.secondary',
            fontSize: '0.75rem',
            '&:hover': { borderColor: theme.palette.text.secondary },
          })}
        >
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Icon glyph={Search} size={13} />
            <Typography component="span" noWrap sx={{ fontSize: 'inherit' }}>
              Buscar ou ir para…
            </Typography>
          </Stack>
          <Typography component="span" sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, fontSize: '0.6875rem' })}>
            {paletteShortcut}
          </Typography>
        </ButtonBase>

        <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
          <Tooltip title={explorerLabel}>
            <IconButton
              data-testid="workspace-toggle-files"
              data-collapsed={explorerCollapsed}
              onClick={() => toggleWorkspacePanel('explorer')}
              size="small"
              sx={{ color: explorerCollapsed ? 'text.disabled' : 'text.secondary' }}
              aria-label={explorerLabel}
            >
              <Icon glyph={PanelLeft} size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title={controlLabel}>
            <IconButton
              data-testid="workspace-toggle-customizations"
              data-collapsed={controlCollapsed}
              onClick={() => toggleWorkspacePanel('control')}
              size="small"
              sx={{ color: controlCollapsed ? 'text.disabled' : 'text.secondary' }}
              aria-label={controlLabel}
            >
              <Icon glyph={PanelRight} size={18} />
            </IconButton>
          </Tooltip>
        </Stack>

        <Divider orientation="vertical" flexItem sx={{ my: 1 }} />

        <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
          <Tooltip title="Configurações">
            <IconButton
              data-testid="nav-settings"
              onClick={() => openConfig()}
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
