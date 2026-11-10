import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Divider, IconButton, InputBase, List, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { GitBranch, Globe, Layers, Plus, Search, X } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { ContainerFooter, ContainerHeader, FooterLink } from '../ds/ContainerChrome.js';
import { useDetected } from '../../hooks/use-detected.js';
import { EntityTreeGroup, seedNewEntity } from './EntityTreeGroup.js';
import { HooksTreeGroup } from './HooksTreeGroup.js';
import { InstructionTreeRow } from './InstructionTreeRow.js';
import { McpTreeGroup } from './McpTreeGroup.js';
import { MINE_KEY, PersistedGroup, type OriginView } from './OriginGroups.js';
import { ENTITY_GROUP_ICONS } from '../shell/nav.js';
import { useFolderRouting } from '../../hooks/use-folder-routing.js';
import { useCustomizationList } from '../../hooks/use-customization-list.js';
import { PluginsTreeGroup } from './PluginsTreeGroup.js';
import { ScopeSection } from './ScopeSection.js';
import { McpEditorDialog } from '../../screens/mcps/McpEditorDialog.js';
import { PluginImportDialog } from '../../screens/plugins/PluginImportDialog.js';
import { useInstructionsList, usePersonalInstruction } from '../../hooks/use-instructions.js';
import { pluginsQueryKey } from '../../hooks/use-plugins.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import { matchesQuery } from '../../lib/control-panel-filter.js';
import { isWorkspaceInstruction } from '../../../shared/entity.js';
import type { Agent, Instruction, Skill } from '../../../shared/entity.js';
import type { DetectedEntity } from '../../../shared/detected.js';

interface LocalScope {
  scope: 'workspace';
  scopeId: string;
}

type EntityKind = 'skill' | 'agent';
type Section = 'local' | 'global';
type RowType = 'instruction' | 'skill' | 'agent' | 'hook' | 'mcp' | 'plugin';

/** The type groups inside a scope section: what "Meus" splits into. */
const TYPE_GROUPS: ReadonlyArray<{ id: string; label: string; glyph: LucideIcon; types: ReadonlyArray<RowType>; alwaysShown?: boolean }> = [
  { id: 'skill', label: 'Skills', glyph: ENTITY_GROUP_ICONS.skill, types: ['skill'], alwaysShown: true },
  { id: 'agent', label: 'Agents', glyph: ENTITY_GROUP_ICONS.agent, types: ['agent'], alwaysShown: true },
  { id: 'integrations', label: 'Integrações', glyph: ENTITY_GROUP_ICONS.mcp, types: ['hook', 'mcp', 'plugin'] },
];

/** Row types the list shows. Plugins are folders under "Integrações", one row per plugin. */
const TYPES: ReadonlyArray<RowType> = ['instruction', 'skill', 'agent', 'hook', 'mcp', 'plugin'];

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
  /** Multi-folder workspace only: a fresh, unsaved instruction for one folder; `takenNames` are the instruction names already used. */
  seedFolderInstruction?: (folder: string, takenNames: ReadonlySet<string>) => Instruction;
  /** Workspace only: opens a Global entity read-only, with an "Editar no Início" action. */
  onOpenInherited: (entity: Skill | Agent | Instruction, kind: EntityKind | 'instruction') => void;
  /** Collapses the container to its header. Owned by the panel split, which sizes the container. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

type NewTarget = EntityKind | 'instruction' | 'mcp' | 'plugin';

/**
 * Every customization of the current scope as one searchable, searchable list,
 * with no group headers (the main header already names the scope): the scope's
 * own items first, then — inside a workspace — Global's, read-only and dimmed.
 * Each item appears exactly once; its type reads from the row's icon and accent
 * spine, its origin from the quiet text at the end of the row, and the
 * Skills and Agents are always listed (the user's own; a plugin's sit under Plugins).
 *
 * Search text is local state: the parent keys this component by
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
  seedFolderInstruction,
  onOpenInherited,
  collapsed = false,
  onToggleCollapsed,
}: CustomizationsListProps): React.ReactElement {
  const qc = useQueryClient();
  const { data: personalInstruction } = usePersonalInstruction();
  const { data: instructions } = useInstructionsList();

  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Items with a problem in some channel, per `section:type` — what a folder shows as `N ⚠`.
  const [problemCounts, setProblemCounts] = useState<Record<string, number>>({});
  const [newMenuAnchor, setNewMenuAnchor] = useState<HTMLElement | null>(null);
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [pluginImportOpen, setPluginImportOpen] = useState(false);

  const report = useCallback((key: string, count: number): void => {
    setCounts((prev) => (prev[key] === count ? prev : { ...prev, [key]: count }));
  }, []);
  const reportProblems = useCallback((key: string, count: number): void => {
    setProblemCounts((prev) => (prev[key] === count ? prev : { ...prev, [key]: count }));
  }, []);

  const types = TYPES;
  const showsType = (type: RowType): boolean => types.includes(type);
  // Instructions are always the user's own — a plugin never provides one.
  const showsInstructions = showsType('instruction');

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
  const filtered = searching;
  const total = localCount + globalCount;
  // The unfiltered total, remembered while no filter is on, so the header and the
  // footer's "12 de 105" keep naming the whole list while a filter narrows it.
  const [baseline, setBaseline] = useState<number | null>(null);
  if (reported && !filtered && baseline !== total) setBaseline(total);
  const grandTotal = baseline ?? total;
  const clearFilters = (): void => setQuery('');

  const instructionCreatable = isHome ? !personalInstruction : seedWorkspaceInstruction !== undefined;
  const create = (target: NewTarget): void => {
    setNewMenuAnchor(null);
    if (target === 'skill' || target === 'agent') onEditEntity(target, seedNewEntity(target, localScope), true);
    else if (target === 'instruction') {
      onOpenInstruction(isHome ? (blankCustomization('instruction') as Instruction) : seedWorkspaceInstruction!(), true);
    } else if (target === 'mcp') setMcpEditorOpen(true);
    else setPluginImportOpen(true);
  };
  const menuTargets: ReadonlyArray<{ target: NewTarget; label: string }> = [
    { target: 'skill', label: 'Skill' },
    { target: 'agent', label: 'Agent' },
    ...(instructionCreatable ? [{ target: 'instruction' as const, label: 'Instruction' }] : []),
    { target: 'mcp', label: 'Servidor MCP' },
    { target: 'plugin', label: 'Importar plugin' },
  ];
  const handleNew = (e: React.MouseEvent<HTMLElement>): void => setNewMenuAnchor(e.currentTarget);

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
  const counter = (section: Section, type: RowType) => ({
    onCount: (n: number) => report(`${section}:${type}`, n),
    onProblems: (n: number) => reportProblems(`${section}:${type}`, n),
  });

  // Skills, agents, hooks and MCP share one origin axis: every type list first
  // reports how many rows each origin has ("census"), then the sections below
  // mount each origin's slice of every type under one "Meus" / plugin header.
  const [buckets, setBuckets] = useState<Record<string, Record<string, number>>>({});
  const reportBuckets = useCallback((key: string, counts: Record<string, number>): void => {
    setBuckets((prev) => (JSON.stringify(prev[key]) === JSON.stringify(counts) ? prev : { ...prev, [key]: counts }));
  }, []);
  type ViewMode = { kind: 'census' } | { kind: 'bucket'; key: string; depth: number };
  const viewProps = (section: Section, type: RowType, mode: ViewMode): { view: OriginView; onCount?: (n: number) => void; onProblems?: (n: number) => void } =>
    mode.kind === 'census'
      ? { view: { kind: 'census', onBuckets: (counts) => reportBuckets(`${section}:${type}`, counts) }, ...counter(section, type) }
      : { view: mode };
  // Hooks and MCP are folders of their own under Integrações: a header at the bucket's depth, rows with it.
  // A census instance renders no rows, so it stays flat (no header) and only reports.
  const folderProps = (section: Section, type: RowType, mode: ViewMode) => ({
    ...viewProps(section, type, mode),
    flat: mode.kind === 'census',
    ...(mode.kind === 'bucket' ? { depth: mode.depth, defaultExpanded: true } : {}),
  });

  const localTypes = (mode: ViewMode, only?: ReadonlyArray<RowType>): React.ReactNode => {
    const on = (type: RowType): boolean => showsType(type) && (only === undefined || only.includes(type));
    return (
    <>
      {on('skill') && <EntityTreeGroup kind="skill" label="Skills" flat origin="mine" query={query} {...viewProps('local', 'skill', mode)} {...entityHandlers} {...scopeProp} />}
      {on('agent') && <EntityTreeGroup kind="agent" label="Agents" flat origin="mine" query={query} {...viewProps('local', 'agent', mode)} {...entityHandlers} {...scopeProp} />}
      {on('hook') && <HooksTreeGroup origin="mine" query={query} showGlobal={false} {...(isHome ? {} : { isProjectContext: true })} {...folderProps('local', 'hook', mode)} />}
      {on('mcp') && (
        <McpTreeGroup origin="mine" query={query} showGlobal={false} {...(mcpMatchPath ? { matchPath: mcpMatchPath } : {})} {...folderProps('local', 'mcp', mode)} />
      )}
    </>
    );
  };
  const globalTypes = (mode: ViewMode, only?: ReadonlyArray<RowType>): React.ReactNode => {
    const on = (type: RowType): boolean => showsType(type) && (only === undefined || only.includes(type));
    return (
    <>
      {on('skill') && <EntityTreeGroup kind="skill" label="Skills" inherited flat origin="mine" query={query} {...viewProps('global', 'skill', mode)} {...inheritedHandlers} {...scopeProp} />}
      {on('agent') && <EntityTreeGroup kind="agent" label="Agents" inherited flat origin="mine" query={query} {...viewProps('global', 'agent', mode)} {...inheritedHandlers} {...scopeProp} />}
      {on('hook') && <HooksTreeGroup origin="mine" query={query} isProjectContext showGlobal {...folderProps('global', 'hook', mode)} />}
      {on('mcp') && (
        <McpTreeGroup origin="mine" query={query} showGlobal onlyGlobal {...(mcpMatchPath ? { matchPath: mcpMatchPath } : {})} {...folderProps('global', 'mcp', mode)} />
      )}
    </>
    );
  };

  // Inside a workspace the groups sit one level under their scope header.
  const base = isHome ? 0 : 1;
  const scopeKey = (section: Section): string => `scope-section:${localScope?.scopeId ?? 'home'}:${section}`;
  const groupKey = (section: Section, suffix: string): string => `tree-subgroup:${localScope?.scopeId ?? 'home'}:${section}:${suffix}`;

  // Plugins are listed once, as closed folders under Integrações: what a plugin provides is reached through it.
  const pluginRows = (section: Section, depth: number, census = false): React.ReactNode =>
    showsType('plugin') && (
      <PluginsTreeGroup
        origin="all"
        depth={depth}
        query={query}
        {...(section === 'local'
          ? { showGlobal: false, ...(isHome ? {} : { isProjectContext: true }) }
          : { isProjectContext: true, showGlobal: true, onlyGlobal: true })}
        {...(census ? { flat: true, countOnly: true, ...counter(section, 'plugin') } : { defaultExpanded: true })}
      />
    );

  // The user's own items split by type (Skills / Agents / Integrações). Plugins are folders under
  // Integrações; what they provide is not listed again in the type groups.
  const originSections = (section: Section, typesFor: (mode: ViewMode, only?: ReadonlyArray<RowType>) => React.ReactNode): { census: React.ReactNode; body: React.ReactNode; mine: React.ReactNode } => {
    const mineCount = (type: RowType): number => {
      if (!showsType(type)) return 0;
      return type === 'plugin' ? (counts[`${section}:plugin`] ?? 0) : (buckets[`${section}:${type}`]?.[MINE_KEY] ?? 0);
    };
    const problemsOf = (type: RowType): number => (showsType(type) ? (problemCounts[`${section}:${type}`] ?? 0) : 0);
    const visibleGroups = TYPE_GROUPS.filter((g) => g.types.some(showsType));
    const groupBody = (g: (typeof TYPE_GROUPS)[number], depth: number): React.ReactNode => (
      <>
        {typesFor({ kind: 'bucket', key: MINE_KEY, depth }, g.types)}
        {g.types.includes('plugin') && pluginRows(section, depth)}
      </>
    );
    const mine = visibleGroups
      .map((g) => ({ g, count: g.types.reduce((sum, type) => sum + mineCount(type), 0), problems: g.types.reduce((sum, type) => sum + problemsOf(type), 0) }))
      .filter(({ g, count }) => count > 0 || (g.alwaysShown === true && !searching))
      .map(({ g, count, problems }) => (
        <PersistedGroup
          key={g.id}
          glyph={g.glyph}
          label={g.label}
          count={count}
          problems={problems}
          channelKinds={g.types}
          storageKey={groupKey(section, `type:${g.id}`)}
          testId={`type-${section}-${g.id}`}
          forceOpen={searching}
          depth={base}
          defaultOpen
        >
          {groupBody(g, base + 1)}
        </PersistedGroup>
      ));
    return {
      mine,
      // Census instances render nothing; they stay outside every collapsible so counts keep flowing.
      census: (
        <>
          {typesFor({ kind: 'census' })}
          {pluginRows(section, 0, true)}
        </>
      ),
      body: mine,
    };
  };
  const localOrigins = originSections('local', localTypes);
  const globalOrigins = originSections('global', globalTypes);

  // Multi-folder workspace: "Neste workspace" splits by origin — the workspace's
  // shared set, then one group per folder (origin › kind › item).
  const routing = useFolderRouting();
  const { data: skillList } = useCustomizationList('skill', 'skill.list');
  const { data: agentList } = useCustomizationList('agent', 'agent.list');
  const { data: detectedList } = useDetected(['skill', 'agent']);
  const detectedCount = (folder: string | null): number =>
    folder === null ? 0 : (detectedList ?? []).filter((d) => d.scope === 'workspace' && d.folder === folder && matchesQuery(query, d.name, d.description)).length;
  const { data: instructionDetected } = useDetected(['instruction']);
  const detectedInstructionAt = (folder: string | undefined): DetectedEntity | undefined =>
    (instructionDetected ?? []).find((d) => d.kind === 'instruction' && d.scope === 'workspace' && d.folder === folder);
  const detectedPersonalInstruction = (instructionDetected ?? []).find((d) => d.kind === 'instruction' && d.scope === 'personal');
  const instructionNames = new Set((instructions ?? []).map((i) => i.name));
  const folderInstructionOf = (folder: string): Instruction | undefined => workspaceInstructions.find((i) => i.folder === folder);
  const instructionRowMatches = matchesQuery(query, 'instructions');
  /** The level's Instructions row — hollow, detected or saved — plus any extra workspace-wide instructions nested under it. */
  const workspaceInstructionRows = (depth: number): React.ReactNode => {
    if (!showsInstructions || !localScope || seedWorkspaceInstruction === undefined) return null;
    const wide = workspaceInstructions.filter((i) => i.folder === undefined);
    const [primary, ...extras] = wide;
    if (primary === undefined && (!instructionRowMatches || searching)) return null;
    return (
      <>
        <InstructionTreeRow
          kind="workspace"
          testId={primary ? `workspace-instruction-row-${primary.name}` : 'workspace-instruction-row'}
          depth={depth}
          instruction={primary}
          detected={detectedInstructionAt(undefined)}
          seed={() => primary ?? seedWorkspaceInstruction()}
          onOpen={onOpenInstruction}
          onPreview={onPreviewEntity}
          onProperties={onInstructionProperties}
          onNewAction={onNewActionForInstruction}
        />
        {extras.map((instruction) => (
          <InstructionTreeRow
            key={instruction.urn}
            kind="workspace"
            label={instruction.name}
            testId={`workspace-instruction-row-${instruction.name}`}
            depth={depth + 1}
            instruction={instruction}
            seed={() => instruction}
            onOpen={onOpenInstruction}
            onPreview={onPreviewEntity}
            onProperties={onInstructionProperties}
            onNewAction={onNewActionForInstruction}
          />
        ))}
      </>
    );
  };
  const folderInstructionRow = (folder: string, depth: number): React.ReactNode => {
    if (!showsInstructions || seedFolderInstruction === undefined) return null;
    const instruction = folderInstructionOf(folder);
    if (instruction === undefined && (!instructionRowMatches || searching)) return null;
    return (
      <InstructionTreeRow
        kind="folder"
        testId={`folder-instruction-row-${routing.aliases[folder] ?? folder}`}
        depth={depth}
        instruction={instruction}
        detected={detectedInstructionAt(folder)}
        seed={() => instruction ?? seedFolderInstruction(folder, instructionNames)}
        onOpen={onOpenInstruction}
        onPreview={onPreviewEntity}
        onProperties={onInstructionProperties}
        onNewAction={onNewActionForInstruction}
      />
    );
  };
  const originCount = (folder: string | null): number =>
    detectedCount(folder) +
    [...(skillList ?? []), ...(agentList ?? [])].filter(
      (e) =>
        e.source.kind !== 'plugin' &&
        e.scopes[0] === 'workspace' &&
        e.scopeId === localScope?.scopeId &&
        e.folder === (folder ?? undefined) &&
        matchesQuery(query, e.name, e.description),
    ).length;
  const originGroups = (): React.ReactNode => {
    if (!localScope || !routing.multi) return null;
    const origins: Array<{ folder: string | null; label: string }> = [
      { folder: null, label: 'Workspace' },
      ...routing.folders.map((folder) => ({ folder, label: routing.aliases[folder] as string })),
    ];
    const integrationsCount =
      (buckets['local:hook']?.[MINE_KEY] ?? 0) + (buckets['local:mcp']?.[MINE_KEY] ?? 0) + (showsType('plugin') ? (counts['local:plugin'] ?? 0) : 0);
    const integrationsProblems = (['hook', 'mcp', 'plugin'] as const).reduce((sum, type) => sum + (showsType(type) ? (problemCounts[`local:${type}`] ?? 0) : 0), 0);
    return origins.map(({ folder, label }) => {
      const scoped = { ...localScope, folder };
      const instruction = folder === null ? workspaceInstructions.find((i) => i.folder === undefined) : folderInstructionOf(folder);
      const hasDetected = detectedInstructionAt(folder ?? undefined) !== undefined;
      const count = originCount(folder) + (instruction !== undefined ? 1 : 0) + (folder === null ? integrationsCount : 0);
      // A level with nothing in it stays put but collapsed and dimmed, so the place to create does not move.
      const empty = count === 0 && !hasDetected;
      return (
        <PersistedGroup
          key={folder ?? '__shared'}
          glyph={folder === null ? Layers : GitBranch}
          label={label}
          count={count}
          storageKey={groupKey('local', `folder:${folder ?? 'shared'}`)}
          testId={`origin-folder-${label}`}
          forceOpen={searching}
          depth={base}
          defaultOpen={!empty}
          muted={empty}
        >
          {folder === null ? workspaceInstructionRows(base + 1) : folderInstructionRow(folder, base + 1)}
          {showsType('skill') && <EntityTreeGroup kind="skill" label="Skills" depth={base + 1} query={query} origin="mine" localScope={scoped} {...entityHandlers} />}
          {showsType('agent') && <EntityTreeGroup kind="agent" label="Agents" depth={base + 1} query={query} origin="mine" localScope={scoped} {...entityHandlers} />}
          {folder === null && (showsType('hook') || showsType('mcp') || showsType('plugin')) && (
            <PersistedGroup
              glyph={ENTITY_GROUP_ICONS.mcp}
              label="Integrações"
              count={integrationsCount}
              problems={integrationsProblems}
              storageKey={groupKey('local', 'folder:shared:integrations')}
              testId="type-local-integrations"
              forceOpen={searching}
              depth={base + 1}
              defaultOpen
              muted={integrationsCount === 0}
            >
              {localTypes({ kind: 'bucket', key: MINE_KEY, depth: base + 2 }, ['hook', 'mcp'])}
              {pluginRows('local', base + 2)}
            </PersistedGroup>
          )}
        </PersistedGroup>
      );
    });
  };

  const localBody = (
    <>
      {homeInstructionRow && (
        <InstructionTreeRow
          kind="personal"
          instruction={personalInstruction}
          detected={detectedPersonalInstruction}
          seed={() => blankCustomization('instruction') as Instruction}
          onOpen={onOpenInstruction}
          onPreview={onPreviewEntity}
          onNewAction={onNewActionForInstruction}
        />
      )}
      {!routing.multi && workspaceInstructionRows(base)}
      {routing.multi && localScope ? (
        <>
          {originGroups()}
        </>
      ) : (
        localOrigins.body
      )}
    </>
  );

  const globalBody = (
    <>
      {inheritedInstructionRow && personalInstruction && (
        <InstructionTreeRow
          kind="personal"
          testId="inherited-instruction-row"
          depth={base}
          instruction={personalInstruction}
          seed={() => personalInstruction}
          onOpen={(entity) => onOpenInherited(entity, 'instruction')}
          onPreview={onPreviewEntity}
        />
      )}
      {globalOrigins.body}
    </>
  );

  // Both bodies stay mounted even when their section is hidden: the type lists
  // report the counts that decide whether a section shows, so unmounting would
  // freeze them at zero once a filter emptied the list.
  const rows = isHome ? (
    <List disablePadding>
      {localOrigins.census}
      {localBody}
    </List>
  ) : (
    <List disablePadding>
      {localOrigins.census}
      {globalOrigins.census}
 {routing.multi ? (
        // Multi-folder: the levels are the top of the tree — Workspace, then one group per folder.
        <Box data-testid="control-panel-levels" sx={isEmpty && searching ? { display: 'none' } : {}}>{localBody}</Box>
      ) : (
        <ScopeSection section="local" glyph={Layers} label="Workspace" count={localCount} storageKey={scopeKey('local')} forceOpen={searching} defaultOpen hidden={isEmpty && searching}>
          {localBody}
        </ScopeSection>
      )}
      {!(reported && globalCount === 0) && !(isEmpty && searching) && <Divider sx={{ mx: 1, my: 0.75 }} />}
      <ScopeSection section="global" glyph={Globe} label="Global" tooltip="Somente leitura aqui — edite no Início" count={globalCount} storageKey={scopeKey('global')} forceOpen={searching} defaultOpen={false} hidden={reported && globalCount === 0}>
        {globalBody}
      </ScopeSection>
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
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', ...(collapsed ? { display: 'none' } : {}) }}>
        {rows}

        {isEmpty && searching && (
          <Typography variant="caption" color="text.secondary" data-testid="control-panel-empty" sx={{ display: 'block', px: 1.5, py: 1 }}>
            Nada encontrado para "{query.trim()}"

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
