import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Chip, IconButton, InputBase, List, ListItemButton, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Plus, Search, X } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { treeGroupLabelSx } from '../ds/TreeRow.js';
import { EntityTreeGroup, seedNewEntity } from './EntityTreeGroup.js';
import { HooksTreeGroup } from './HooksTreeGroup.js';
import { InstructionTreeRow } from './InstructionTreeRow.js';
import { McpTreeGroup } from './McpTreeGroup.js';
import { PluginsTreeGroup } from './PluginsTreeGroup.js';
import { McpEditorDialog } from '../../screens/mcps/McpEditorDialog.js';
import { PluginImportDialog } from '../../screens/plugins/PluginImportDialog.js';
import { useInstructionsList, usePersonalInstruction } from '../../hooks/use-instructions.js';
import { pluginsQueryKey } from '../../hooks/use-plugins.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import { matchesQuery } from '../../lib/control-panel-filter.js';
import { isWorkspaceInstruction } from '../../../shared/entity.js';
import type { Agent, Instruction, Skill } from '../../../shared/entity.js';

interface LocalScope {
  scope: 'workspace';
  scopeId: string;
}

type EntityKind = 'skill' | 'agent';
type ChipId = 'all' | 'skill' | 'agent' | 'integrations';
type Section = 'local' | 'global';
type RowType = 'instruction' | 'skill' | 'agent' | 'hook' | 'mcp' | 'plugin';

const CHIPS: ReadonlyArray<{ id: ChipId; label: string }> = [
  { id: 'all', label: 'Tudo' },
  { id: 'skill', label: 'Skills' },
  { id: 'agent', label: 'Agents' },
  { id: 'integrations', label: 'Integrações' },
];

const TYPES_BY_CHIP: Record<ChipId, ReadonlyArray<RowType>> = {
  all: ['instruction', 'skill', 'agent', 'hook', 'mcp', 'plugin'],
  skill: ['skill'],
  agent: ['agent'],
  integrations: ['hook', 'mcp', 'plugin'],
};

export interface CustomizationsListProps {
  /** True at Início (Global): a single editable section. False while a workspace is open — or still loading. */
  isHome: boolean;
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
}

type NewTarget = EntityKind | 'instruction' | 'mcp' | 'plugin';

/**
 * Every customization of the current scope as one searchable, filterable list:
 * the scope's own items first, then — inside a workspace — Global's, read-only
 * and collapsed. Each item appears exactly once; its type reads from the row's
 * icon and accent spine, not from a group header.
 *
 * Chip and search text are local state: the parent keys this component by
 * scope so they reset on workspace switch.
 */
export function CustomizationsList({
  isHome,
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
}: CustomizationsListProps): React.ReactElement {
  const qc = useQueryClient();
  const { data: personalInstruction } = usePersonalInstruction();
  const { data: instructions } = useInstructionsList();

  const [chip, setChip] = useState<ChipId>('all');
  const [query, setQuery] = useState('');
  const [globalOpen, setGlobalOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [newMenuAnchor, setNewMenuAnchor] = useState<HTMLElement | null>(null);
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [pluginImportOpen, setPluginImportOpen] = useState(false);

  const report = useCallback((key: string, count: number): void => {
    setCounts((prev) => (prev[key] === count ? prev : { ...prev, [key]: count }));
  }, []);

  const types = TYPES_BY_CHIP[chip];
  const showsType = (type: RowType): boolean => types.includes(type);

  const workspaceInstructions = localScope
    ? (instructions ?? []).filter(
        (i) => isWorkspaceInstruction(i) && i.scopeId === localScope.scopeId && matchesQuery(query, i.name, i.description),
      )
    : [];
  // Início always lists the singleton (unconfigured, its row is the "create" affordance);
  // inside a workspace it is a read-only Global row, so only a saved one shows.
  const personalRowMatches = matchesQuery(query, 'instructions', personalInstruction?.name, personalInstruction?.description);
  const homeInstructionRow = isHome && showsType('instruction') && personalRowMatches;
  const inheritedInstructionRow = !isHome && showsType('instruction') && personalInstruction != null && personalRowMatches;

  const rowCount = (section: Section, type: RowType): number => {
    if (!showsType(type)) return 0;
    if (type === 'instruction') {
      if (section === 'local') return isHome ? Number(homeInstructionRow) : workspaceInstructions.length;
      return Number(inheritedInstructionRow);
    }
    return counts[`${section}:${type}`] ?? 0;
  };
  const sectionCount = (section: Section): number => types.reduce((sum, type) => sum + rowCount(section, type), 0);
  const localCount = sectionCount('local');
  const globalCount = isHome ? 0 : sectionCount('global');
  const reported = types.every((type) => type === 'instruction' || `local:${type}` in counts);
  const isEmpty = reported && localCount + globalCount === 0;
  const searching = query.trim() !== '';
  const globalExpanded = globalOpen || (searching && globalCount > 0);

  const instructionCreatable = isHome ? !personalInstruction : seedWorkspaceInstruction !== undefined;
  const create = (target: NewTarget): void => {
    setNewMenuAnchor(null);
    if (target === 'skill' || target === 'agent') onEditEntity(target, seedNewEntity(target, localScope), true);
    else if (target === 'instruction') {
      onOpenInstruction(isHome ? (blankCustomization('instruction') as Instruction) : seedWorkspaceInstruction!(), true);
    } else if (target === 'mcp') setMcpEditorOpen(true);
    else setPluginImportOpen(true);
  };
  const menuTargets: ReadonlyArray<{ target: NewTarget; label: string }> =
    chip === 'integrations'
      ? [
          { target: 'mcp', label: 'Servidor MCP' },
          { target: 'plugin', label: 'Importar plugin' },
        ]
      : [
          { target: 'skill', label: 'Skill' },
          { target: 'agent', label: 'Agent' },
          ...(instructionCreatable ? [{ target: 'instruction' as const, label: 'Instruction' }] : []),
        ];
  const handleNew = (e: React.MouseEvent<HTMLElement>): void => {
    if (chip === 'skill' || chip === 'agent') create(chip);
    else setNewMenuAnchor(e.currentTarget);
  };

  const entityHandlers = {
    onEdit: onEditEntity,
    onPreview: onPreviewEntity,
    onProperties: onEntityProperties,
    onNewAction: onNewActionForEntity,
  };
  const inheritedHandlers = {
    onEdit: (kind: EntityKind, entity: Skill | Agent) => onOpenInherited(entity, kind),
    onPreview: onPreviewEntity,
    onNewAction: onNewActionForEntity,
  };
  const scopeProp = localScope ? { localScope } : {};
  const counter = (section: Section, type: RowType) => ({ onCount: (n: number) => report(`${section}:${type}`, n) });

  const localRows = (
    <List disablePadding>
      {homeInstructionRow && (
        <InstructionTreeRow
          kind="personal"
          depth={1.25}
          instruction={personalInstruction}
          seed={() => blankCustomization('instruction') as Instruction}
          onOpen={onOpenInstruction}
          onPreview={onPreviewEntity}
          onNewAction={onNewActionForInstruction}
        />
      )}
      {showsType('instruction') &&
        workspaceInstructions.map((instruction) => (
          <InstructionTreeRow
            key={instruction.urn}
            kind="workspace"
            depth={1.25}
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
      {showsType('skill') && <EntityTreeGroup kind="skill" label="Skills" flat query={query} {...counter('local', 'skill')} {...entityHandlers} {...scopeProp} />}
      {showsType('agent') && <EntityTreeGroup kind="agent" label="Agents" flat query={query} {...counter('local', 'agent')} {...entityHandlers} {...scopeProp} />}
      {showsType('hook') && <HooksTreeGroup flat query={query} showGlobal={false} {...(isHome ? {} : { isProjectContext: true })} {...counter('local', 'hook')} />}
      {showsType('mcp') && (
        <McpTreeGroup flat query={query} showGlobal={false} {...(mcpMatchPath ? { matchPath: mcpMatchPath } : {})} {...counter('local', 'mcp')} />
      )}
      {showsType('plugin') && <PluginsTreeGroup flat query={query} showGlobal={false} {...(isHome ? {} : { isProjectContext: true })} {...counter('local', 'plugin')} />}
    </List>
  );

  const globalRows = (
    <List disablePadding>
      {inheritedInstructionRow && personalInstruction && (
        <InstructionTreeRow
          kind="personal"
          depth={1.25}
          testId="inherited-instruction-row"
          instruction={personalInstruction}
          seed={() => personalInstruction}
          onOpen={(entity) => onOpenInherited(entity, 'instruction')}
          onPreview={onPreviewEntity}
        />
      )}
      {showsType('skill') && (
        <EntityTreeGroup kind="skill" label="Skills" inherited flat query={query} {...counter('global', 'skill')} {...inheritedHandlers} {...scopeProp} />
      )}
      {showsType('agent') && (
        <EntityTreeGroup kind="agent" label="Agents" inherited flat query={query} {...counter('global', 'agent')} {...inheritedHandlers} {...scopeProp} />
      )}
      {showsType('hook') && <HooksTreeGroup flat query={query} isProjectContext showGlobal {...counter('global', 'hook')} />}
      {showsType('mcp') && (
        <McpTreeGroup flat query={query} showGlobal onlyGlobal {...(mcpMatchPath ? { matchPath: mcpMatchPath } : {})} {...counter('global', 'mcp')} />
      )}
      {showsType('plugin') && <PluginsTreeGroup flat query={query} isProjectContext showGlobal onlyGlobal {...counter('global', 'plugin')} />}
    </List>
  );

  return (
    <Box data-testid="control-panel-customizations" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Stack spacing={0.75} sx={{ px: 1.5, pb: 0.75, flexShrink: 0 }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Box
            sx={(theme) => ({
              display: 'flex', alignItems: 'center', gap: 0.5, flexGrow: 1, minWidth: 0, px: 0.75,
              border: `1px solid ${theme.palette.divider}`, borderRadius: `${theme.ogs.radius.xs}px`,
            })}
          >
            <Icon glyph={Search} size={13} />
            <InputBase
              fullWidth
              placeholder="Buscar customizações"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputProps={{ 'aria-label': 'Buscar customizações', 'data-testid': 'control-panel-search' }}
              sx={{ fontSize: '0.8rem', py: 0.25 }}
            />
            {searching && (
              <IconButton size="small" aria-label="Limpar busca" data-testid="control-panel-search-clear" onClick={() => setQuery('')} sx={{ p: 0.25 }}>
                <Icon glyph={X} size={12} />
              </IconButton>
            )}
          </Box>
          <Tooltip title="Novo">
            <IconButton size="small" aria-label="Novo" data-testid="control-panel-new" onClick={handleNew} sx={{ p: 0.5 }}>
              <Icon glyph={Plus} size={14} />
            </IconButton>
          </Tooltip>
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
          {CHIPS.map(({ id, label }) => (
            <Chip
              key={id}
              size="small"
              label={label}
              data-testid={`control-panel-chip-${id}`}
              color={chip === id ? 'primary' : 'default'}
              variant={chip === id ? 'filled' : 'outlined'}
              onClick={() => setChip(id)}
              sx={{ height: 20, fontSize: '0.6875rem' }}
            />
          ))}
        </Stack>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <SectionHeader testId="control-panel-section-local" label={isHome ? 'Global' : 'Neste workspace'} count={localCount} />
        {localRows}

        {!isHome && (
          <>
            <SectionHeader
              testId="control-panel-section-global"
              label="Do Global"
              count={globalCount}
              expanded={globalExpanded}
              onToggle={() => setGlobalOpen((v) => !v)}
            />
            {/* Mounted while collapsed so the rows keep reporting counts — search must expand this section on a hit. */}
            <Box sx={{ display: globalExpanded ? 'block' : 'none' }} data-testid="control-panel-global-rows">
              {globalRows}
            </Box>
          </>
        )}

        {isEmpty && (
          <Typography variant="caption" color="text.secondary" data-testid="control-panel-empty" sx={{ display: 'block', px: 1.5, py: 1 }}>
            {searching ? `Nada encontrado para "${query.trim()}"` : 'Nada aqui ainda'}
          </Typography>
        )}
      </Box>

      <Menu anchorEl={newMenuAnchor} open={newMenuAnchor !== null} onClose={() => setNewMenuAnchor(null)}>
        {menuTargets.map(({ target, label }) => (
          <MenuItem key={target} data-testid={`control-panel-new-${target}`} onClick={() => create(target)}>
            {label}
          </MenuItem>
        ))}
      </Menu>
      {mcpEditorOpen && <McpEditorDialog open mode="create" onClose={() => setMcpEditorOpen(false)} />}
      <PluginImportDialog
        open={pluginImportOpen}
        scope={isHome ? 'personal' : 'project'}
        onClose={() => setPluginImportOpen(false)}
        onSuccess={() => {
          setPluginImportOpen(false);
          void qc.invalidateQueries({ queryKey: pluginsQueryKey('personal') });
          void qc.invalidateQueries({ queryKey: pluginsQueryKey('project') });
        }}
      />
    </Box>
  );
}

interface SectionHeaderProps {
  testId: string;
  label: string;
  count: number;
  /** Present only for a collapsible section. */
  expanded?: boolean;
  onToggle?: () => void;
}

function SectionHeader({ testId, label, count, expanded, onToggle }: SectionHeaderProps): React.ReactElement {
  const content = (
    <>
      {onToggle && <Icon glyph={expanded ? ChevronDown : ChevronRight} size={14} />}
      <Typography component="span" sx={{ ...treeGroupLabelSx, flexGrow: 1 }}>
        {label}
      </Typography>
      <Typography component="span" sx={{ fontSize: '0.6875rem', color: 'text.disabled' }}>
        {count}
      </Typography>
    </>
  );
  return onToggle ? (
    <ListItemButton dense data-testid={testId} onClick={onToggle} sx={{ px: 1.5, py: 0.25, gap: 0.5, minHeight: 22 }}>
      {content}
    </ListItemButton>
  ) : (
    <Stack direction="row" data-testid={testId} sx={{ alignItems: 'center', px: 1.5, py: 0.25, gap: 0.5, minHeight: 22 }}>
      {content}
    </Stack>
  );
}
