import { useState } from 'react';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Kicker } from '../ds/Kicker.js';
import { treeGroupLabelSx } from '../ds/TreeRow.js';
import { CustomizationsList, type CustomizationsListProps } from './CustomizationsList.js';
import { SessionsTreeGroup } from './SessionsTreeGroup.js';
import type { HistoryScope } from '../../../shared/session-history.js';
import type { SessionSnapshot } from '../../../shared/session.js';

interface ControlPanelContentProps extends CustomizationsListProps {
  /** The open workspace's name, once known. */
  workspaceName?: string;
  /** This scope's own sessions — `personal` at Início, the workspace otherwise. */
  sessionsScope: HistoryScope;
  onOpenSession: (session: Pick<SessionSnapshot, 'sessionId' | 'anchor' | 'label'>) => void;
  onSessionRemoved: (sessionId: string) => void;
  onSeeAllSessions: () => void;
  canStartSession: boolean;
  onNewSession: () => void;
}

/**
 * The right panel — "what": the scope's own Sessões first (live, used
 * constantly), then its Customizations as one searchable list. Inside a
 * workspace, Global's items stay reachable — read-only — under a collapsed
 * "Do Global" section. Sessões and Customizations split the panel height and
 * each scrolls on its own.
 */
export function ControlPanelContent({
  workspaceName,
  sessionsScope,
  onOpenSession,
  onSessionRemoved,
  onSeeAllSessions,
  canStartSession,
  onNewSession,
  ...customizations
}: ControlPanelContentProps): React.ReactElement {
  const { isHome, localScope } = customizations;

  // A local accordion (body only) — independent of the panel's own collapse.
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const toggleSessions = (): void => setSessionsExpanded((v) => !v);

  return (
    <Box data-testid="workspace-customizations" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 1.5, pt: 1, pb: 0.5, flexShrink: 0 }} data-testid="control-panel-kicker">
        <Kicker>{isHome ? 'Global' : workspaceName ? `Workspace · ${workspaceName}` : 'Workspace'}</Kicker>
      </Box>

      <Box
        data-testid="workspace-sessions-panel"
        sx={{
          flex: sessionsExpanded ? '1 1 0' : '0 0 auto',
          minHeight: sessionsExpanded ? 120 : 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minHeight: 22, pl: 0.75, pr: 1, flexShrink: 0 }}>
          <IconButton
            size="small"
            data-testid="workspace-sessions-collapse"
            aria-label={sessionsExpanded ? 'Ocultar sessões' : 'Mostrar sessões'}
            onClick={toggleSessions}
            sx={{ p: 0.25 }}
          >
            <Icon glyph={sessionsExpanded ? ChevronDown : ChevronRight} size={14} />
          </IconButton>
          <Typography component="span" sx={{ ...treeGroupLabelSx, flexGrow: 1 }}>
            Sessões
          </Typography>
          <Tooltip title="Nova sessão">
            {/* span wrapper keeps the tooltip working while the button is disabled */}
            <span>
              <IconButton
                size="small"
                data-testid="workspace-sessions-new"
                aria-label="Nova sessão"
                disabled={!canStartSession}
                onClick={onNewSession}
                sx={{ p: 0.25 }}
              >
                <Icon glyph={Plus} size={14} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        {sessionsExpanded && (
          // SessionsTreeGroup owns its own internal scroll box, so its footer
          // ("Ver todas") stays pinned below the rows.
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <SessionsTreeGroup scope={sessionsScope} onOpen={onOpenSession} onRemoved={onSessionRemoved} onSeeAll={onSeeAllSessions} />
          </Box>
        )}
      </Box>

      <Box sx={{ flex: '1 1 0', minHeight: 160, display: 'flex', flexDirection: 'column', mt: 0.75 }}>
        {/* Remounts on scope change, so chip, search text and "Do Global" state reset. */}
        <CustomizationsList key={isHome ? 'home' : (localScope?.scopeId ?? 'workspace')} {...customizations} />
      </Box>
    </Box>
  );
}
