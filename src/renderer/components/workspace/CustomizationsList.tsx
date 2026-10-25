import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Button, Chip, IconButton, InputBase, List, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronDown, Plus, Search, X } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { ContainerFooter, ContainerHeader, FooterLink } from '../ds/ContainerChrome.js';
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
import { matchesOrigin, matchesQuery, type OriginSegment } from '../../lib/control-panel-filter.js';
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

const SEGMENTS: ReadonlyArray<{ id: OriginSegment; label: string }> = [
  { id: 'mine', label: 'Meus' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'all', label: 'Todos' },
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
  /** Collapses the container to its header. Owned by the panel split, which sizes the container. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

type NewTarget = EntityKind | 'instruction' | 'mcp' | 'plugin';

/**
 * Every customization of the current scope as one searchable, filterable list,
 * with no group headers (the main header already names the scope): the scope's
 * own items first, then — inside a workspace — Global's, read-only and dimmed.
 * Each item appears exactly once; its type reads from the row's icon and accent
 * spine, its origin from the quiet text at the end of the row, and the
 * origin menu (Todos/Meus/Plugins) narrows it by origin.
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
  collapsed = false,
  onToggleCollapsed,
}: CustomizationsListProps): React.ReactElement {
  const qc = useQueryClient();
  const { data: personalInstruction } = usePersonalInstruction();
  const { data: instructions } = useInstructionsList();

  const [chip, setChip] = useState<ChipId>('all');
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<OriginSegment>('all');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [originAnchor, setOriginAnchor] = useState<HTMLElement | null>(null);
  const [newMenuAnchor, setNewMenuAnchor] = useState<HTMLElement | null>(null);
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [pluginImportOpen, setPluginImportOpen] = useState(false);

  const report = useCallback((key: string, count: number): void => {
    setCounts((prev) => (prev[key] === count ? prev : { ...prev, [key]: count }));
  }, []);

  const types = TYPES_BY_CHIP[chip];
  const showsType = (type: RowType): boolean => types.includes(type);
  // Instructions are always the user's own — a plugin never provides one.
  const showsInstructions = showsType('instruction') && matchesOrigin(segment, false);

  const workspaceInstructions = localScope
    ? (instructions ?? []).filter(
        (i) => isWorkspaceInstruction(i) && i.scopeId === localScope.scopeId && matchesQuery(query, i.name, i.description),
      )
    : [];
  // Início always lists the singleton (unconfigured, its row is the "create" affordance);
  // inside a workspace it is a read-only Global row, so only a saved one shows.
  const personalRowMatches = matchesQuery(query, 'instructions', personalInstruction?.name, personalInstruction?.description);
  const homeInstructionRow = isHome && showsInstructions && personalRowMatches;
  const inheritedInstructionRow = !isHome && showsInstructions && personalInstruction != null && personalRowMatches;

  const rowCount = (section: Section, type: RowType): number => {
    if (!showsType(type)) return 0;
    if (type === 'instruction') {
      if (!showsInstructions) return 0;
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
  const filtered = searching || chip !== 'all' || segment !== 'all';
  const total = localCount + globalCount;
  // The unfiltered total, remembered while no filter is on, so the header and the
  // footer's "12 de 105" keep naming the whole list while a filter narrows it.
  const [baseline, setBaseline] = useState<number | null>(null);
  if (reported && !filtered && baseline !== total) setBaseline(total);
  const grandTotal = baseline ?? total;
  const clearFilters = (): void => {
    setQuery('');
    setChip('all');
    setSegment('all');
  };

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
          instruction={personalInstruction}
          seed={() => blankCustomization('instruction') as Instruction}
          onOpen={onOpenInstruction}
          onPreview={onPreviewEntity}
          onNewAction={onNewActionForInstruction}
        />
      )}
      {showsInstructions &&
        workspaceInstructions.map((instruction) => (
          <InstructionTreeRow
            key={instruction.urn}
            kind="workspace"
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
      {showsType('skill') && <EntityTreeGroup kind="skill" label="Skills" flat query={query} origin={segment} {...counter('local', 'skill')} {...entityHandlers} {...scopeProp} />}
      {showsType('agent') && <EntityTreeGroup kind="agent" label="Agents" flat query={query} origin={segment} {...counter('local', 'agent')} {...entityHandlers} {...scopeProp} />}
      {showsType('hook') && <HooksTreeGroup flat query={query} origin={segment} showGlobal={false} {...(isHome ? {} : { isProjectContext: true })} {...counter('local', 'hook')} />}
      {showsType('mcp') && (
        <McpTreeGroup flat query={query} origin={segment} showGlobal={false} {...(mcpMatchPath ? { matchPath: mcpMatchPath } : {})} {...counter('local', 'mcp')} />
      )}
      {showsType('plugin') && <PluginsTreeGroup flat query={query} origin={segment} showGlobal={false} {...(isHome ? {} : { isProjectContext: true })} {...counter('local', 'plugin')} />}
    </List>
  );

  const globalRows = (
    <List disablePadding>
      {inheritedInstructionRow && personalInstruction && (
        <InstructionTreeRow
          kind="personal"
          testId="inherited-instruction-row"
          instruction={personalInstruction}
          seed={() => personalInstruction}
          onOpen={(entity) => onOpenInherited(entity, 'instruction')}
          onPreview={onPreviewEntity}
        />
      )}
      {showsType('skill') && (
        <EntityTreeGroup kind="skill" label="Skills" inherited flat query={query} origin={segment} {...counter('global', 'skill')} {...inheritedHandlers} {...scopeProp} />
      )}
      {showsType('agent') && (
        <EntityTreeGroup kind="agent" label="Agents" inherited flat query={query} origin={segment} {...counter('global', 'agent')} {...inheritedHandlers} {...scopeProp} />
      )}
      {showsType('hook') && <HooksTreeGroup flat query={query} origin={segment} isProjectContext showGlobal {...counter('global', 'hook')} />}
      {showsType('mcp') && (
        <McpTreeGroup flat query={query} origin={segment} showGlobal onlyGlobal {...(mcpMatchPath ? { matchPath: mcpMatchPath } : {})} {...counter('global', 'mcp')} />
      )}
      {showsType('plugin') && <PluginsTreeGroup flat query={query} origin={segment} isProjectContext showGlobal onlyGlobal {...counter('global', 'plugin')} />}
    </List>
  );

  return (
    <Box data-testid="control-panel-customizations" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <ContainerHeader
        title="Customizações"
        testId="control-panel"
        collapsed={collapsed}
        onToggle={() => onToggleCollapsed?.()}
        {...(reported ? { count: grandTotal } : {})}
        actions={
          <Tooltip title="Novo">
            <IconButton size="small" aria-label="Novo" data-testid="control-panel-new" onClick={handleNew} sx={{ p: 0.5 }}>
              <Icon glyph={Plus} size={14} />
            </IconButton>
          </Tooltip>
        }
      />
      <Stack spacing={0.75} sx={{ px: 1.5, pb: 0.75, flexShrink: 0, ...(collapsed ? { display: 'none' } : {}) }}>
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
              placeholder="Buscar por nome ou descrição"
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
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5, flexGrow: 1 }}>
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
          <Button
            size="small"
            color={segment === 'all' ? 'inherit' : 'primary'}
            aria-label="Origem"
            aria-haspopup="menu"
            data-testid="control-panel-origin"
            endIcon={<Icon glyph={ChevronDown} size={12} />}
            onClick={(e) => setOriginAnchor(e.currentTarget)}
            sx={{ flexShrink: 0, minWidth: 0, py: 0, px: 0.5, fontSize: '0.6875rem', textTransform: 'none' }}
          >
            {SEGMENTS.find((s) => s.id === segment)?.label}
          </Button>
        </Stack>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', ...(collapsed ? { display: 'none' } : {}) }}>
        {localRows}
        {!isHome && globalRows}

        {isEmpty && (
          <Typography variant="caption" color="text.secondary" data-testid="control-panel-empty" sx={{ display: 'block', px: 1.5, py: 1 }}>
            {searching ? `Nada encontrado para "${query.trim()}"` : 'Nada aqui ainda'}
          </Typography>
        )}
      </Box>

      {!collapsed && (
        <ContainerFooter testId="control-panel-footer">
          <span>
            <Box component="span" data-testid="control-panel-footer-count" sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, fontWeight: 500, color: 'text.primary', fontVariantNumeric: 'tabular-nums' })}>
              {total}
            </Box>
            {filtered ? ` de ${grandTotal} itens` : total === 1 ? ' item' : ' itens'}
          </span>
          {filtered && (
            <FooterLink testId="control-panel-clear" onClick={clearFilters}>
              Limpar filtros
            </FooterLink>
          )}
        </ContainerFooter>
      )}

      <Menu anchorEl={originAnchor} open={originAnchor !== null} onClose={() => setOriginAnchor(null)}>
        {SEGMENTS.map(({ id, label }) => (
          <MenuItem
            key={id}
            selected={segment === id}
            data-testid={`control-panel-segment-${id}`}
            onClick={() => {
              setSegment(id);
              setOriginAnchor(null);
            }}
          >
            {label}
          </MenuItem>
        ))}
      </Menu>
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
