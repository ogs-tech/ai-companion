import { useState } from 'react';
import { Box, IconButton, List, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Globe, Layers, NotebookPen, Plus } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Kicker } from '../ds/Kicker.js';
import { treeGroupLabelSx } from '../ds/TreeRow.js';
import { EntityTreeGroup } from './EntityTreeGroup.js';
import { HooksTreeGroup } from './HooksTreeGroup.js';
import { InstructionTreeRow } from './InstructionTreeRow.js';
import { McpTreeGroup } from './McpTreeGroup.js';
import { PluginsTreeGroup } from './PluginsTreeGroup.js';
import { SessionsTreeGroup } from './SessionsTreeGroup.js';
import { TreeGroup } from './TreeGroup.js';
import { useInstructionsList, usePersonalInstruction } from '../../hooks/use-instructions.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import { isWorkspaceInstruction } from '../../../shared/entity.js';
import type { HistoryScope } from '../../../shared/session-history.js';
import type { Agent, Instruction, Skill } from '../../../shared/entity.js';
import type { SessionSnapshot } from '../../../shared/session.js';

interface LocalScope {
  scope: 'workspace';
  scopeId: string;
}

type EntityKind = 'skill' | 'agent';

interface ControlPanelContentProps {
  /** True at Início (Global). False while a workspace is open — or still loading. */
  isHome: boolean;
  /** The open workspace's name, once known. */
  workspaceName?: string;
  localScope?: LocalScope;
  mcpMatchPath?: string;
  onEditEntity: (kind: EntityKind, entity: Skill | Agent, isCreate: boolean) => void;
  onPreviewEntity: (entity: Skill | Agent | Instruction) => void;
  onEntityProperties: (kind: EntityKind, entity: Skill | Agent) => void;
  onNewActionForEntity: (kind: EntityKind, entity: Skill | Agent) => void;
  onOpenInstruction: (entity: Instruction, isCreate: boolean) => void;
  onInstructionProperties: (entity: Instruction) => void;
  onNewActionForInstruction: (entity: Instruction) => void;
  /** Workspace only: a fresh, unsaved instruction for "+". */
  seedWorkspaceInstruction?: () => Instruction;
  /** Workspace only: opens a Global entity read-only, with an "Editar no Início" action. */
  onOpenInherited: (entity: Skill | Agent | Instruction, kind: EntityKind | 'instruction') => void;
  /** This scope's own sessions — `personal` at Início, the workspace otherwise. */
  sessionsScope: HistoryScope;
  onOpenSession: (session: Pick<SessionSnapshot, 'sessionId' | 'anchor' | 'label'>) => void;
  onSessionRemoved: (sessionId: string) => void;
  onSeeAllSessions: () => void;
  canStartSession: boolean;
  onNewSession: () => void;
}

/**
 * The right panel — "what": everything that belongs to the current scope,
 * Instruction first, then Skills, Agents, Integrações and the scope's own
 * Sessões. Inside a workspace, Global's skills/agents/instruction stay
 * reachable — read-only — under a collapsed "Herdado do Global".
 */
export function ControlPanelContent({
  isHome,
  workspaceName,
  localScope,
  mcpMatchPath,
  onEditEntity,
  onPreviewEntity,
  onEntityProperties,
  onNewActionForEntity,
  onOpenInstruction,
  onInstructionProperties,
  onNewActionForInstruction,
  seedWorkspaceInstruction,
  onOpenInherited,
  sessionsScope,
  onOpenSession,
  onSessionRemoved,
  onSeeAllSessions,
  canStartSession,
  onNewSession,
}: ControlPanelContentProps): React.ReactElement {
  const { data: personalInstruction } = usePersonalInstruction();
  const { data: instructions } = useInstructionsList();
  const workspaceInstructions = localScope
    ? (instructions ?? []).filter((i) => isWorkspaceInstruction(i) && i.scopeId === localScope.scopeId)
    : [];

  // A local accordion (body only) — independent of the panel's own collapse.
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const toggleSessions = (): void => setSessionsExpanded((v) => !v);

  const entityHandlers = {
    onEdit: onEditEntity,
    onPreview: onPreviewEntity,
    onProperties: onEntityProperties,
    onNewAction: onNewActionForEntity,
  };

  const instructionGroup = isHome ? (
    <TreeGroup testId="instruction" glyph={NotebookPen} label="Instruction" defaultExpanded>
      <InstructionTreeRow
        kind="personal"
        depth={1}
        instruction={personalInstruction}
        seed={() => blankCustomization('instruction') as Instruction}
        onOpen={onOpenInstruction}
        onPreview={onPreviewEntity}
        onNewAction={onNewActionForInstruction}
      />
    </TreeGroup>
  ) : (
    <TreeGroup
      testId="instruction"
      glyph={NotebookPen}
      label="Instruction"
      count={workspaceInstructions.length}
      defaultExpanded
      {...(seedWorkspaceInstruction
        ? { onCreate: () => onOpenInstruction(seedWorkspaceInstruction(), true), createLabel: 'Nova instruction' }
        : {})}
    >
      {workspaceInstructions.map((instruction) => (
        <InstructionTreeRow
          key={instruction.urn}
          kind="workspace"
          depth={1}
          label={instruction.name}
          testId={`workspace-instruction-row-${instruction.name}`}
          instruction={instruction}
          seed={() => instruction}
          onOpen={onOpenInstruction}
          onPreview={onPreviewEntity}
          onProperties={onInstructionProperties}
          onNewAction={onNewActionForInstruction}
        />
      ))}
    </TreeGroup>
  );

  return (
    <Box data-testid="workspace-customizations" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 1.5, pt: 1, pb: 0.5, flexShrink: 0 }} data-testid="control-panel-kicker">
        <Kicker>{isHome ? 'Global' : workspaceName ? `Workspace · ${workspaceName}` : 'Workspace'}</Kicker>
      </Box>

      <List disablePadding sx={{ flexShrink: 0 }}>
        {instructionGroup}
        <EntityTreeGroup kind="skill" label="Skills" {...entityHandlers} {...(localScope ? { localScope } : {})} />
        <EntityTreeGroup kind="agent" label="Agents" {...entityHandlers} {...(localScope ? { localScope } : {})} />
        {/* Hooks/MCP/Plugins are the low-frequency, more technical kinds — set up once
            rather than edited daily like Skills/Agents — so they share one collapsed
            "Integrações" row instead of each claiming its own always-visible header. */}
        <TreeGroup testId="integrations" glyph={Layers} label="Integrações">
          {isHome ? (
            <>
              <HooksTreeGroup showGlobal={false} />
              <McpTreeGroup showGlobal={false} />
              <PluginsTreeGroup showGlobal={false} />
            </>
          ) : (
            <>
              <HooksTreeGroup isProjectContext showGlobal={false} />
              <McpTreeGroup showGlobal={false} {...(mcpMatchPath ? { matchPath: mcpMatchPath } : {})} />
              <PluginsTreeGroup isProjectContext showGlobal={false} />
            </>
          )}
        </TreeGroup>
      </List>

      {/* The scope's own sessions. Its collapse only hides this block's body (a
          local accordion), unlike the panel's own collapse. */}
      <Box
        data-testid="workspace-sessions-panel"
        sx={{
          mt: 0.75,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: sessionsExpanded ? 300 : 'auto',
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

      {!isHome && (
        <List disablePadding sx={{ flexShrink: 0, mt: 0.75 }}>
          <TreeGroup testId="inherited" glyph={Globe} label="Herdado do Global">
            {personalInstruction && (
              <InstructionTreeRow
                kind="personal"
                depth={1}
                testId="inherited-instruction-row"
                instruction={personalInstruction}
                seed={() => personalInstruction}
                onOpen={(entity) => onOpenInherited(entity, 'instruction')}
                onPreview={onPreviewEntity}
              />
            )}
            <EntityTreeGroup
              kind="skill"
              label="Skills"
              inherited
              depth={1}
              onEdit={(kind, entity) => onOpenInherited(entity, kind)}
              onPreview={onPreviewEntity}
              onNewAction={onNewActionForEntity}
              {...(localScope ? { localScope } : {})}
            />
            <EntityTreeGroup
              kind="agent"
              label="Agents"
              inherited
              depth={1}
              onEdit={(kind, entity) => onOpenInherited(entity, kind)}
              onPreview={onPreviewEntity}
              onNewAction={onNewActionForEntity}
              {...(localScope ? { localScope } : {})}
            />
          </TreeGroup>
        </List>
      )}
    </Box>
  );
}
