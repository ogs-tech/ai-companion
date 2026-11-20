import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box } from '@mui/material';
import { Activity, CircleAlert, GitBranch } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { ContextSwitcher } from './ContextSwitcher.js';
import { DiagnosticsStatus } from './DiagnosticsStatus.js';
import { gitStatusOptions } from '../../hooks/use-git.js';
import { useSessions } from '../../hooks/use-sessions.js';
import { useActiveWorkspace } from '../../hooks/use-workspaces.js';
import { dispatchMenuCommand } from '../../lib/menu-commands.js';
import { getShellStatus, subscribeShellStatus } from '../../lib/shell-status-store.js';

interface StatusBarProps {
  /** The switcher's "Todos…": opens the palette on its workspace list. */
  onOpenWorkspacePicker: () => void;
}

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
 * The one global status bar. Left: where you are — the workspace switcher (also the way back to Início) and the git branch.
 * Right, only what changes what you do next: cursor and save state (only with
 * an editor active), one sessions summary with "precisa de você" first (click →
 * jumps to it), then the diagnostics state (click → summary popover). Which channels
 * are on lives in Configurações; idle sessions are not
 * information and are not counted. Layout controls live in the header; the context switcher lives here.
 * Every item is derived from state that already exists; nothing here detects anything.
 */
export function StatusBar({ onOpenWorkspacePicker }: StatusBarProps): React.ReactElement {
  const { data: workspace } = useActiveWorkspace();
  const { data: sessions } = useSessions();
  const { tab, cursor } = useSyncExternalStore(subscribeShellStatus, getShellStatus);
  const inWorkspace = workspace !== undefined && workspace !== null;
  // Git exists only inside a workspace (at Início the call is rejected), and one fetch is enough here: git operations invalidate the query.
  const { data: git } = useQuery({ ...gitStatusOptions(undefined, false), enabled: inWorkspace });
  const branch = git?.isRepo ? git.head.name : null;
  const live = (sessions ?? []).filter((s) => s.status === 'running');
  const needsYou = live.filter((s) => s.activity === 'needs-input').length;
  const working = live.filter((s) => s.activity === 'working').length;

  return (
    <Box
      component="footer"
      data-testid="status-bar"
      sx={{
        flexShrink: 0,
        height: 24,
        // Canvas-coloured and borderless, like the header: the bar reads as part of the canvas.
        bgcolor: 'background.default',
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
      <ContextSwitcher onOpenAllWorkspaces={onOpenWorkspacePicker} />
      {branch !== null && branch !== undefined && (
        <Box component="span" data-testid="status-branch" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <Icon glyph={GitBranch} size={12} />
          {branch}
        </Box>
      )}

      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.75 }}>
        {cursor !== null && (
          <Box component="span" data-testid="status-cursor">{`Ln ${cursor.line}, Col ${cursor.column}`}</Box>
        )}
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

        {(needsYou > 0 || working > 0) && (
          <Box component="span" data-testid="status-sessions" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25 }}>
            {needsYou > 0 && (
              <Box
                component="span"
                data-testid="status-needs-you"
                {...buttonProps(() => dispatchMenuCommand('go-needs-attention'))}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'warning.main', fontWeight: 600, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
              >
                <Icon glyph={CircleAlert} size={12} />
                {needsYou === 1 ? '1 sessão precisa de você' : `${needsYou} sessões precisam de você`}
              </Box>
            )}
            {working > 0 && (
              <Box component="span" data-testid="status-working" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'success.main' }}>
                <Icon glyph={Activity} size={12} />
                {`${working} trabalhando`}
              </Box>
            )}
          </Box>
        )}

        <DiagnosticsStatus />
      </Box>
    </Box>
  );
}
