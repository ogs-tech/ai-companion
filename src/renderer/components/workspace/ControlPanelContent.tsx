import { useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { Group, Panel, usePanelRef } from 'react-resizable-panels';
import { Plus } from 'lucide-react';
import { ContainerHeader } from '../ds/ContainerChrome.js';
import { Icon } from '../ds/Icon.js';
import { ResizeHandle } from '../ds/ResizeHandle.js';
import { CustomizationsList, type CustomizationsListProps } from './CustomizationsList.js';
import { SessionsTreeGroup, liveInScope } from './SessionsTreeGroup.js';
import { useSessions } from '../../hooks/use-sessions.js';
import type { HistoryScope } from '../../../shared/session-history.js';
import type { SessionSnapshot } from '../../../shared/session.js';

interface ControlPanelContentProps extends CustomizationsListProps {
  /** This scope's own sessions — `personal` at Início, the workspace otherwise. */
  sessionsScope: HistoryScope;
  onOpenSession: (session: Pick<SessionSnapshot, 'sessionId' | 'anchor' | 'label'>) => void;
  onSessionRemoved: (sessionId: string) => void;
  onSeeAllSessions: () => void;
  canStartSession: boolean;
  onNewSession: () => void;
}

/**
 * The right panel — "what", with no scope title (the main header already
 * names the scope): the scope's own Sessões first (live, used constantly),
 * then its Customizations as one searchable list. Inside a workspace,
 * Global's items stay reachable — read-only and dimmed — after the
 * workspace's own. Sessões and Customizations split the panel height with a
 * draggable divider (Sessões collapses to its title by dragging down to
 * nothing, or with its chevron) and each scrolls on its own.
 */
export function ControlPanelContent({
  sessionsScope,
  onOpenSession,
  onSessionRemoved,
  onSeeAllSessions,
  canStartSession,
  onNewSession,
  ...customizations
}: ControlPanelContentProps): React.ReactElement {
  const { isHome, localScope } = customizations;

  const sessionsPanelRef = usePanelRef();
  const customizationsPanelRef = usePanelRef();
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [customizationsExpanded, setCustomizationsExpanded] = useState(true);
  const { data: liveSessions } = useSessions();
  const running = liveInScope(liveSessions ?? [], sessionsScope).filter((s) => s.status === 'running').length;

  // `onResize` keeps these in step with dragging; they are also set here
  // because jsdom never lays panels out, so `collapse()` alone would not
  // report back.
  const toggle = (panel: ReturnType<typeof usePanelRef>, expanded: boolean, set: (v: boolean) => void): void => {
    if (expanded) panel.current?.collapse();
    else panel.current?.expand();
    set(!expanded);
  };

  return (
    <Box data-testid="workspace-customizations" sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Group orientation="vertical" style={{ flex: 1, minHeight: 0 }}>
        <Panel
          id="control-panel-sessions-split"
          panelRef={sessionsPanelRef}
          collapsible
          collapsedSize={40}
          defaultSize="40"
          minSize={120}
          onResize={(size) => setSessionsExpanded(size.inPixels > 48)}
          style={{ overflow: 'hidden' }}
        >
          <Box data-testid="workspace-sessions-panel" sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <ContainerHeader
              title="Sessões"
              testId="workspace-sessions"
              collapsed={!sessionsExpanded}
              onToggle={() => toggle(sessionsPanelRef, sessionsExpanded, setSessionsExpanded)}
              status={
                running > 0 ? (
                  <Typography
                    component="span"
                    data-testid="workspace-sessions-running"
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 0.625, fontSize: '0.75rem', fontWeight: 500, color: 'success.main',
                      '&::before': { content: '""', width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main' },
                    }}
                  >
                    {running === 1 ? '1 ativa' : `${running} ativas`}
                  </Typography>
                ) : undefined
              }
              actions={
                <Tooltip title="Nova sessão">
                  {/* span wrapper keeps the tooltip working while the button is disabled */}
                  <span>
                    <IconButton size="small" data-testid="workspace-sessions-new" aria-label="Nova sessão" disabled={!canStartSession} onClick={onNewSession} sx={{ p: 0.5 }}>
                      <Icon glyph={Plus} size={14} />
                    </IconButton>
                  </span>
                </Tooltip>
              }
            />
            {sessionsExpanded && (
              // SessionsTreeGroup owns its own internal scroll box, so its footer
              // stays pinned below the rows.
              <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <SessionsTreeGroup scope={sessionsScope} onOpen={onOpenSession} onRemoved={onSessionRemoved} onSeeAll={onSeeAllSessions} />
              </Box>
            )}
          </Box>
        </Panel>
        <ResizeHandle orientation="vertical" />
        <Panel
          id="control-panel-customizations-split"
          panelRef={customizationsPanelRef}
          collapsible
          collapsedSize={40}
          minSize={160}
          onResize={(size) => setCustomizationsExpanded(size.inPixels > 48)}
          style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          {/* Remounts on scope change, so chip, search text and origin reset. */}
          <CustomizationsList
            key={isHome ? 'home' : (localScope?.scopeId ?? 'workspace')}
            {...customizations}
            collapsed={!customizationsExpanded}
            onToggleCollapsed={() => toggle(customizationsPanelRef, customizationsExpanded, setCustomizationsExpanded)}
          />
        </Panel>
      </Group>
    </Box>
  );
}
