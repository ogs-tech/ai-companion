import { useState } from 'react';
import { Box, IconButton, List, Stack, Tooltip } from '@mui/material';
import { ChevronDown, ChevronRight, Layers, Plus, SquareTerminal } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Kicker } from '../ds/Kicker.js';
import { EntityTreeGroup } from './EntityTreeGroup.js';
import { HooksTreeGroup } from './HooksTreeGroup.js';
import { McpTreeGroup } from './McpTreeGroup.js';
import { PluginsTreeGroup } from './PluginsTreeGroup.js';
import { SessionsTreeGroup } from './SessionsTreeGroup.js';
import { TreeGroup } from './TreeGroup.js';
import type { HistoryScope } from '../../../shared/session-history.js';
import type { Agent, Skill } from '../../../shared/entity.js';
import type { SessionSnapshot } from '../../../shared/session.js';

interface LocalScope {
  scope: 'workspace' | 'project';
  scopeId: string;
}

interface ControlPanelContentProps {
  isDefaultWorkspace: boolean;
  showGlobal: boolean;
  localScope?: LocalScope;
  mcpMatchPath?: string;
  onEditEntity: (kind: 'skill' | 'agent', entity: Skill | Agent, isCreate: boolean) => void;
  onPreviewEntity: (entity: Skill | Agent) => void;
  onEntityProperties: (kind: 'skill' | 'agent', entity: Skill | Agent) => void;
  onNewActionForEntity: (kind: 'skill' | 'agent', entity: Skill | Agent) => void;
  historyScope: HistoryScope | null;
  onOpenSession: (session: Pick<SessionSnapshot, 'sessionId' | 'anchor' | 'label'>) => void;
  onSessionRemoved: (sessionId: string) => void;
  onSeeAllSessions: () => void;
  canStartSession: boolean;
  onNewSession: () => void;
}

/**
 * The Control Panel's body, below the shared `SidePanel` header: the
 * Sessões block (own local collapse, independent of the panel itself), then
 * the Customizations tree (Skills/Agents/Hooks/MCP/Plugins).
 */
export function ControlPanelContent({
  isDefaultWorkspace,
  showGlobal,
  localScope,
  mcpMatchPath,
  onEditEntity,
  onPreviewEntity,
  onEntityProperties,
  onNewActionForEntity,
  historyScope,
  onOpenSession,
  onSessionRemoved,
  onSeeAllSessions,
  canStartSession,
  onNewSession,
}: ControlPanelContentProps): React.ReactElement {
  // A local accordion (body only) — independent of the panel's own
  // collapse-to-0, which hides this whole component instead.
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const toggleSessions = (): void => setSessionsExpanded((v) => !v);

  const customizationRows = isDefaultWorkspace ? (
    <>
      <EntityTreeGroup kind="skill" label="Skills" showGlobal={false} onEdit={onEditEntity} onPreview={onPreviewEntity} onProperties={onEntityProperties} onNewAction={onNewActionForEntity} />
      <EntityTreeGroup kind="agent" label="Agents" showGlobal={false} onEdit={onEditEntity} onPreview={onPreviewEntity} onProperties={onEntityProperties} onNewAction={onNewActionForEntity} />
      {/* Hooks/MCP/Plugins are the low-frequency, more technical kinds — set up once
          rather than edited daily like Skills/Agents — so they share one collapsed
          "Integrações" row instead of each claiming its own always-visible header. */}
      <TreeGroup testId="integrations" glyph={Layers} label="Integrações">
        <HooksTreeGroup showGlobal={false} />
        <McpTreeGroup showGlobal={false} />
        <PluginsTreeGroup showGlobal={false} />
      </TreeGroup>
    </>
  ) : (
    <>
      <EntityTreeGroup kind="skill" label="Skills" showGlobal={showGlobal} onEdit={onEditEntity} onPreview={onPreviewEntity} onProperties={onEntityProperties} onNewAction={onNewActionForEntity} {...(localScope ? { localScope } : {})} />
      <EntityTreeGroup kind="agent" label="Agents" showGlobal={showGlobal} onEdit={onEditEntity} onPreview={onPreviewEntity} onProperties={onEntityProperties} onNewAction={onNewActionForEntity} {...(localScope ? { localScope } : {})} />
      <TreeGroup testId="integrations" glyph={Layers} label="Integrações">
        <HooksTreeGroup isProjectContext showGlobal={showGlobal} />
        <McpTreeGroup showGlobal={showGlobal} {...(mcpMatchPath ? { matchPath: mcpMatchPath } : {})} />
        <PluginsTreeGroup isProjectContext showGlobal={showGlobal} />
      </TreeGroup>
    </>
  );

  return (
    <>
      {/* Stacked above Customizations, not nested inside it as one more tree
          row — a session is reachable/actionable even when its own
          entity/project/workspace tab isn't open, so it earns its own
          always-visible section instead of hiding inside a collapsed group.
          Its collapse only hides this block's own body (a local accordion),
          unlike the panel's own collapse, which hides this whole component. */}
      <Box
        data-testid="workspace-sessions-panel"
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: sessionsExpanded ? 260 : 'auto',
          overflow: 'hidden',
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, flexShrink: 0 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Icon glyph={SquareTerminal} size={14} />
            <Kicker>Sessões</Kicker>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Tooltip title="Nova sessão">
              {/* span wrapper keeps the tooltip working while the button is disabled (no project/workspace in view yet) */}
              <span>
                <IconButton size="small" data-testid="workspace-sessions-new" aria-label="Nova sessão" disabled={!canStartSession} onClick={onNewSession}>
                  <Icon glyph={Plus} size={16} />
                </IconButton>
              </span>
            </Tooltip>
            <IconButton
              size="small"
              data-testid="workspace-sessions-collapse"
              aria-label={sessionsExpanded ? 'Ocultar sessões' : 'Mostrar sessões'}
              onClick={toggleSessions}
            >
              <Icon glyph={sessionsExpanded ? ChevronDown : ChevronRight} size={16} />
            </IconButton>
          </Stack>
        </Stack>
        {sessionsExpanded && (
          // No overflow here: SessionsTreeGroup owns its own internal scroll
          // box now, so its fixed footer ("Ver todas") stays pinned below the
          // rows rather than sharing their scroll area.
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <SessionsTreeGroup scope={historyScope ?? { kind: 'all' }} onOpen={onOpenSession} onRemoved={onSessionRemoved} onSeeAll={onSeeAllSessions} />
          </Box>
        )}
      </Box>
      <Stack
        data-testid="workspace-customizations-header"
        direction="row"
        sx={{ alignItems: 'center', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        <Kicker>Customizations</Kicker>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <List disablePadding>{customizationRows}</List>
      </Box>
    </>
  );
}
