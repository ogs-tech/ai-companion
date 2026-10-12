import { useState } from 'react';
import { Box, IconButton, List, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Layers, Plus } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { treeGroupLabelSx } from '../ds/TreeRow.js';
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

/**
 * A non-default workspace is always "as a Project" (a single registered Project, or none yet)
 * or "with multiple projects" — fully derived from `projects.length`, never persisted. See
 * docs/superpowers/specs/2026-09-19-workspace-view-mode-design.md decision #1.
 */
export type WorkspaceViewMode = 'project' | 'multi-project';

interface ControlPanelContentProps {
  isDefaultWorkspace: boolean;
  showGlobal: boolean;
  viewMode: WorkspaceViewMode;
  /** The Project currently in view (whichever Workbench tab is active) — `undefined` when no tab is Project-scoped. Only rendered when `viewMode === 'multi-project'`; a single Project needs no disambiguation. */
  selectedProjectName?: string;
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
 * The Control Panel's body inside the shared `SidePanel` card: the Sessões
 * block (own local collapse, independent of the panel itself), then the
 * Customizations tree (Skills/Agents/Hooks/MCP/Plugins).
 */
export function ControlPanelContent({
  isDefaultWorkspace,
  showGlobal,
  viewMode,
  selectedProjectName,
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
      {/* Only meaningful once a workspace juggles more than one Project — a
          single Project needs nothing to disambiguate. Falls back to a
          neutral "Workspace" label whenever the active tab isn't scoped to
          any Project (a workspace-anchored session, Starter Pack, ...). */}
      {viewMode === 'multi-project' && (
        <Typography
          data-testid="control-panel-scope-chip"
          noWrap
          sx={{ flexShrink: 0, px: 1.5, pt: 0.75, textAlign: 'right', fontSize: '0.6875rem', color: 'text.secondary' }}
        >
          {selectedProjectName ? `Projeto: ${selectedProjectName}` : 'Workspace'}
        </Typography>
      )}
      {/* Stacked above Customizations, not nested inside it as one more tree
          row — a session is reachable/actionable even when its own
          entity/project/workspace tab isn't open, so it earns its own
          always-visible section instead of hiding inside a collapsed group.
          Its collapse only hides this block's own body (a local accordion),
          unlike the panel's own collapse, which hides this whole component. */}
      <Box
        data-testid="workspace-sessions-panel"
        sx={{
          mt: 0.75,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: sessionsExpanded ? 260 : 'auto',
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
            {/* span wrapper keeps the tooltip working while the button is disabled (no project/workspace in view yet) */}
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
          // No overflow here: SessionsTreeGroup owns its own internal scroll
          // box now, so its fixed footer ("Ver todas") stays pinned below the
          // rows rather than sharing their scroll area.
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <SessionsTreeGroup scope={historyScope ?? { kind: 'all' }} onOpen={onOpenSession} onRemoved={onSessionRemoved} onSeeAll={onSeeAllSessions} />
          </Box>
        )}
      </Box>
      <Box data-testid="workspace-customizations" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', mt: 0.75 }}>
        <List disablePadding>{customizationRows}</List>
      </Box>
    </>
  );
}
