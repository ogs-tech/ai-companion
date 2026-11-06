import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Tooltip } from '@mui/material';
import { HARNESSES, HARNESS_IDS } from '../../../shared/harness.js';
import { useAreaNavigation } from '../../hooks/use-area-navigation.js';
import { gitStatusOptions } from '../../hooks/use-git.js';
import { useSessions } from '../../hooks/use-sessions.js';
import { useSettings } from '../../hooks/use-settings.js';
import { useActiveWorkspace } from '../../hooks/use-workspaces.js';
import { dispatchMenuCommand } from '../../lib/menu-commands.js';
import { getShellStatus, subscribeShellStatus } from '../../lib/shell-status-store.js';

type HealthSeverity = 'ok' | 'warning' | 'error';

interface StatusBarProps {
  healthSeverity?: HealthSeverity;
}

const SYNC_COLOR: Record<HealthSeverity, 'success.main' | 'warning.main' | 'error.main'> = {
  ok: 'success.main',
  warning: 'warning.main',
  error: 'error.main',
};

const SYNC_LABEL: Record<HealthSeverity, string> = {
  ok: 'sincronizado',
  warning: 'atenção',
  error: 'erro',
};

const SYNC_TOOLTIP: Record<HealthSeverity, string> = {
  ok: 'Tudo sincronizado com Claude Code/Cursor.',
  warning: 'Alguns itens estão desincronizados — ver Diagnóstico.',
  error: 'Falha ao sincronizar — ver Diagnóstico.',
};

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Role=button behaviour for a clickable span: click, Enter and Space. */
function buttonProps(onActivate: () => void): {
  role: 'button';
  tabIndex: 0;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
} {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.key === ' ') e.preventDefault();
      onActivate();
    },
  };
}

/**
 * The one global status bar. Left: where you are (workspace, git branch).
 * Right, in the order the user acts on them: save state of the active file,
 * sessions that need you (click → jumps to the first), cursor position, then
 * sync health (click → Diagnóstico) and which harness adapters are on.
 * Every item is derived from state that already exists; nothing here detects anything.
 */
export function StatusBar({ healthSeverity }: StatusBarProps): React.ReactElement {
  const navigate = useAreaNavigation();
  const { data: settings } = useSettings();
  const { data: workspace } = useActiveWorkspace();
  const { data: sessions } = useSessions();
  const { tab, cursor } = useSyncExternalStore(subscribeShellStatus, getShellStatus);
  const inWorkspace = workspace !== undefined && workspace !== null;
  // Git exists only inside a workspace (at Início the call is rejected), and one fetch is enough here: git operations invalidate the query.
  const { data: git } = useQuery({ ...gitStatusOptions(undefined, false), enabled: inWorkspace });
  const branch = git?.isRepo ? git.head.name : null;
  const needsYou = (sessions ?? []).filter((s) => s.status === 'running' && s.activity === 'needs-input').length;

  return (
    <Box
      component="footer"
      data-testid="status-bar"
      sx={{
        flexShrink: 0,
        height: 24,
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        px: 1.75,
        display: 'flex',
        alignItems: 'center',
        gap: 1.75,
        fontSize: '0.6875rem',
        color: 'text.secondary',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {inWorkspace && (
        <Box component="span" data-testid="status-workspace" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {workspace.name}
          {branch !== null && branch !== undefined && <Box component="span" data-testid="status-branch">{` · ⎇ ${branch}`}</Box>}
        </Box>
      )}

      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.75 }}>
        {tab?.editable === true && tab.dirty && (
          <Box component="span" data-testid="status-save-state" sx={{ color: 'warning.main' }}>
            Alterações não salvas
          </Box>
        )}
        {tab?.editable === true && !tab.dirty && tab.savedAt !== null && (
          <Box component="span" data-testid="status-save-state">
            {`Salvo às ${timeFormat.format(tab.savedAt)}`}
          </Box>
        )}

        {needsYou > 0 && (
          <Box
            component="span"
            data-testid="status-needs-you"
            {...buttonProps(() => dispatchMenuCommand('go-needs-attention'))}
            sx={{ color: 'warning.main', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
          >
            {needsYou === 1 ? '! 1 sessão precisa de você' : `! ${needsYou} sessões precisam de você`}
          </Box>
        )}

        {cursor !== null && (
          <Box component="span" data-testid="status-cursor">{`Ln ${cursor.line}, Col ${cursor.column}`}</Box>
        )}

        {healthSeverity !== undefined && (
          <Tooltip title={SYNC_TOOLTIP[healthSeverity]}>
            <Box
              data-testid="status-pill-sync"
              data-variant={healthSeverity}
              {...buttonProps(() => navigate('diagnostico'))}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, cursor: 'pointer', '&:hover': { color: 'text.primary' } }}
            >
              <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: SYNC_COLOR[healthSeverity] }} />
              {SYNC_LABEL[healthSeverity]}
            </Box>
          </Tooltip>
        )}

        {settings &&
          HARNESS_IDS.map((id) => {
            const enabled = settings.adapters[id]?.enabled ?? false;
            return (
              <Box component="span" key={id} data-testid={`status-adapter-${id}`} data-enabled={enabled}>
                {HARNESSES[id].displayName}
                <Box component="span" sx={{ color: enabled ? 'inherit' : 'text.disabled' }}>
                  {enabled ? ' ✓' : ' —'}
                </Box>
              </Box>
            );
          })}
      </Box>
    </Box>
  );
}
