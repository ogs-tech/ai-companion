import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Divider, IconButton, InputBase, List, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { Globe, Layers, Plus, Puzzle, ScrollText, Search, X } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { ContainerFooter, ContainerHeader, FooterLink } from '../ds/ContainerChrome.js';
import { EntityTreeRow, seedNewEntity, type EntityRowHandlers } from './EntityTreeRow.js';
import { DetectedTreeRow } from './DetectedTreeRow.js';
import { HookTreeRow } from './HookTreeRow.js';
import { InstructionTreeRow } from './InstructionTreeRow.js';
import { McpTreeRow } from './McpTreeRow.js';
import { PluginTreeRow } from './PluginTreeRow.js';
import { PersistedGroup } from './TreeGroup.js';
import { TreeFilterChips } from './TreeFilterChips.js';
import { ScopeSection } from './ScopeSection.js';
import { ENTITY_GROUP_ICONS } from '../shell/nav.js';
import { useCustomizationTree } from '../../hooks/use-customization-tree.js';
import { McpEditorDialog } from '../../screens/mcps/McpEditorDialog.js';
import { HookEditorDialog } from '../../screens/hooks/HookEditorDialog.js';
import { CUSTOMIZATION_KINDS } from '../../../shared/customization-kind.js';
import { PluginImportDialog } from '../../screens/plugins/PluginImportDialog.js';
import { usePersonalInstruction, useInstructionsList } from '../../hooks/use-instructions.js';
import { pluginsQueryKey } from '../../hooks/use-plugins.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import type { TreeFilter, TreeGroup, TreeGroupId, TreeItem, TreeSection } from '../../lib/customization-tree.js';
import type { Agent, Instruction, Skill } from '../../../shared/entity.js';
import { invalidateHealth } from '../../hooks/use-health-report.js';
import { UNDO_DELETE_WINDOW_MS, UndoableDeleteContext, useUndoableDelete } from '../../hooks/use-undoable-delete.js';
import { Toast } from '../Toast.js';
import type { ChannelId } from '../../../shared/channel.js';

interface LocalScope {
  scope: 'workspace';
  scopeId: string;
}

type EntityKind = 'skill' | 'agent';

const GROUP_GLYPH: Record<TreeGroupId, LucideIcon> = {
  instruction: ScrollText,
  skill: ENTITY_GROUP_ICONS.skill,
  agent: ENTITY_GROUP_ICONS.agent,
  mcp: ENTITY_GROUP_ICONS.mcp,
  hook: ENTITY_GROUP_ICONS.hook,
  plugin: Puzzle,
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
  /** Multi-folder workspace only: a fresh, unsaved instruction for one folder; `takenNames` are the instruction names already used. */
  seedFolderInstruction?: (folder: string, takenNames: ReadonlySet<string>) => Instruction;
  /** Workspace only: opens a Global entity read-only, with an "Editar no Início" action. */
  onOpenInherited: (entity: Skill | Agent | Instruction, kind: EntityKind | 'instruction') => void;
  /** Workspace only: "Editar no Início" from a Global row's menu — leaves the workspace and opens the entity there. */
  onEditAtHome?: (entity: Skill | Agent | Instruction, kind: EntityKind | 'instruction') => void;
  /** Collapses the container to its header. Owned by the panel split, which sizes the container. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

type NewTarget = EntityKind | 'instruction' | 'mcp' | 'hook' | 'plugin';

/**
 * Every customization of the current scope: its instruction row(s) ("Instructions") first, then one group
 * per type (Skills, Agents, MCP, Hooks, Plugins). Inside a workspace the tree splits into a Workspace section and a read-only
 * Global section (Início's items, collapsed by default). Rows show only the exception — `⚠ <canais>` (error) or
 * `draft · importar | desativado` — from `customization.status`; the chips (Todos · Instalado · Draft ·
 * Com erro, plus a channel row for the last two) filter by it and combine with the search. The tree comes
 * from one pure model (`buildCustomizationTree`), so every count equals what the list shows.
 *
 * Search and chip are local state: the parent keys this component by scope, so they reset on a switch.
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
  onEditAtHome,
  collapsed = false,
  onToggleCollapsed,
}: CustomizationsListProps): React.ReactElement {
  const qc = useQueryClient();
  // Excluir/Remover on any row: hidden here at once, deleted when the undo window ends.
  const undo = useUndoableDelete();
  const { data: personalInstruction } = usePersonalInstruction();
  const { data: instructions } = useInstructionsList();

  const [query, setQuery] = useState('');
  const [filter, setFilterState] = useState<TreeFilter>('all');
  const [channel, setChannel] = useState<ChannelId | undefined>(undefined);
  // The channel sub-filter belongs to the status chip it narrows.
  const setFilter = (next: TreeFilter): void => {
    setFilterState(next);
    setChannel(undefined);
  };
  const [newMenuAnchor, setNewMenuAnchor] = useState<HTMLElement | null>(null);
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [hookEditorOpen, setHookEditorOpen] = useState(false);
  const [pluginImportOpen, setPluginImportOpen] = useState(false);

  const tree = useCustomizationTree({
    isHome,
    ...(localScope ? { localScope } : {}),
    ...(mcpMatchPath !== undefined ? { mcpMatchPath } : {}),
    query,
    filter,
    ...(channel !== undefined ? { channel } : {}),
  });
  const searching = query.trim() !== '';
  const filtered = searching || filter !== 'all';
  const clearFilters = (): void => {
    setQuery('');
    setFilter('all');
  };

  const instructionCreatable = isHome ? !personalInstruction : seedWorkspaceInstruction !== undefined;
  const create = (target: NewTarget): void => {
    setNewMenuAnchor(null);
    if (target === 'skill' || target === 'agent') onEditEntity(target, seedNewEntity(target, localScope), true);
    else if (target === 'instruction') {
      onOpenInstruction(isHome ? (blankCustomization('instruction') as Instruction) : seedWorkspaceInstruction!(), true);
    } else if (target === 'mcp') setMcpEditorOpen(true);
    else if (target === 'hook') setHookEditorOpen(true);
    else setPluginImportOpen(true);
  };
  // One entry per kind, in the registry's (= the tree's) order; a plugin is an origin, so it is imported, not created.
  const menuTargets: ReadonlyArray<{ target: NewTarget; label: string }> = [
    ...CUSTOMIZATION_KINDS.filter((k) => k.kind !== 'instruction' || instructionCreatable).map((k) => ({ target: k.kind, label: k.label })),
    { target: 'plugin', label: 'Importar plugin' },
  ];
  const handleNew = (e: React.MouseEvent<HTMLElement>): void => setNewMenuAnchor(e.currentTarget);

  const entityHandlers: EntityRowHandlers = {
    onEdit: onEditEntity,
    onOpenInherited: (entity, kind) => onOpenInherited(entity, kind),
    onPreview: onPreviewEntity,
    onProperties: onEntityProperties,
    onNewAction: onNewActionForEntity,
    ...(onEditAtHome ? { onEditAtHome: (entity: Skill | Agent, kind: 'skill' | 'agent') => onEditAtHome(entity, kind) } : {}),
  };
  const instructionNames = new Set((instructions ?? []).map((i) => i.name));

  const instructionRow = (item: TreeItem, depth: number): React.ReactNode => {
    if (item.entity.kind !== 'instruction' || undo.pendingKeys.has(item.urn)) return null;
    const { value, placement, folder, detected } = item.entity;
    const shared = { key: item.key, item, depth, instruction: value, detected, onPreview: onPreviewEntity };
    if (placement === 'personal') {
      if (item.origin === 'global' && value) {
        return <InstructionTreeRow {...shared} kind="personal" testId="inherited-instruction-row" seed={() => value} onOpen={(entity) => onOpenInherited(entity, 'instruction')} {...(onEditAtHome ? { onEditAtHome: (entity: Instruction) => onEditAtHome(entity, 'instruction') } : {})} />;
      }
      return (
        <InstructionTreeRow
          {...shared}
          kind="personal"
          seed={() => blankCustomization('instruction') as Instruction}
          onOpen={onOpenInstruction}
          onNewAction={onNewActionForInstruction}
        />
      );
    }
    const seed = placement === 'folder' ? (folder !== undefined && seedFolderInstruction ? () => seedFolderInstruction(folder, instructionNames) : undefined) : seedWorkspaceInstruction;
    if (value === undefined && seed === undefined) return null;
    return (
      <InstructionTreeRow
        {...shared}
        kind={placement}
        testId={placement === 'folder' ? `folder-instruction-row-${item.folderAlias ?? folder ?? ''}` : value ? `workspace-instruction-row-${value.name}` : 'workspace-instruction-row'}
        seed={() => value ?? seed!()}
        onOpen={onOpenInstruction}
        onProperties={onInstructionProperties}
        onNewAction={onNewActionForInstruction}
      />
    );
  };

  const groupRows = (group: TreeGroup, depth: number): React.ReactNode => {
    // Two MCP servers with the same name differ only by where they are configured — say so on those rows.
    const mcpNames = new Map<string, number>();
    if (group.id === 'mcp') for (const item of group.items) mcpNames.set(item.name, (mcpNames.get(item.name) ?? 0) + 1);
    return group.items.filter((item) => !undo.pendingKeys.has(item.urn)).map((item) => {
      switch (item.entity.kind) {
        case 'instruction':
          return instructionRow(item, depth);
        case 'skill':
        case 'agent':
          return <EntityTreeRow key={item.key} item={item} handlers={entityHandlers} depth={depth} />;
        case 'detected':
          return <DetectedTreeRow key={item.key} item={item} depth={depth} />;
        case 'mcp':
          return <McpTreeRow key={item.key} item={item} showScope={(mcpNames.get(item.name) ?? 0) > 1} depth={depth} />;
        case 'hook':
          return <HookTreeRow key={item.key} item={item} depth={depth} />;
        case 'plugin':
          return <PluginTreeRow key={item.key} item={item} depth={depth} />;
      }
    });
  };

  const scopeKey = localScope?.scopeId ?? 'home';
  const isEmpty = filtered && tree.shown === 0;
  // Inside a workspace the tree sits one level under its section header.
  const sectioned = !isHome && localScope !== undefined;
  const base = sectioned ? 1 : 0;
  /** A section's body: its instruction row(s) right under it, ungrouped, then one collapsible group per type. */
  const sectionBody = (section: TreeSection): React.ReactNode =>
    section.groups.map((group) => {
      if (group.id === 'instruction') return groupRows(group, base);
      const id = section.id === 'global' ? `global-${group.id}` : group.id;
      return (
        <PersistedGroup
          key={group.id}
          id={id}
          glyph={GROUP_GLYPH[group.id]}
          label={group.label}
          count={group.count}
          problems={group.problems}
          storageKey={`tree-group:${scopeKey}:${section.id}:${group.id}`}
          forceOpen={filtered}
          depth={base}
          defaultOpen
          empty={group.items.length === 0}
        >
          {groupRows(group, base + 1)}
        </PersistedGroup>
      );
    });
  const localSection = tree.sections.find((s) => s.id === 'local');
  const globalSection = tree.sections.find((s) => s.id === 'global');
  const rows = !sectioned ? (
    <List disablePadding>{localSection && sectionBody(localSection)}</List>
  ) : (
    <List disablePadding>
      {localSection && (
        <ScopeSection
          section="local"
          glyph={Layers}
          label="Workspace"
          count={localSection.count}
          storageKey={`scope-section:${scopeKey}:local`}
          forceOpen={filtered}
          defaultOpen
          hidden={isEmpty || (filtered && localSection.count === 0)}
        >
          {sectionBody(localSection)}
        </ScopeSection>
      )}
      {globalSection && (
        <>
          {!isEmpty && localSection !== undefined && !(filtered && localSection.count === 0) && <Divider sx={{ mx: 1, my: 0.75 }} />}
          <ScopeSection
            section="global"
            glyph={Globe}
            label="Global"
            tooltip="Somente leitura aqui — edite no Início"
            count={globalSection.count}
            storageKey={`scope-section:${scopeKey}:global`}
            forceOpen={filtered}
            defaultOpen={false}
          >
            {sectionBody(globalSection)}
          </ScopeSection>
        </>
      )}
    </List>
  );
  const footerTail = filtered
    ? ` de ${tree.grandTotal} itens`
    : `${tree.grandTotal === 1 ? ' item' : ' itens'}${tree.totals.global > 0 ? `, ${tree.totals.global} do Global` : ''}`;

  return (
    <Box data-testid="control-panel-customizations" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <ContainerHeader
        title="Customizações"
        testId="control-panel"
        collapsed={collapsed}
        onToggle={() => onToggleCollapsed?.()}
        count={tree.grandTotal}
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
        <TreeFilterChips value={filter} channel={channel} totals={tree.totals} onChange={setFilter} onChannelChange={setChannel} />
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', ...(collapsed ? { display: 'none' } : {}) }}>
        <UndoableDeleteContext.Provider value={undo.requestDelete}>{rows}</UndoableDeleteContext.Provider>

        {isEmpty && (
          <Typography variant="caption" color="text.secondary" data-testid="control-panel-empty" sx={{ display: 'block', px: 1.5, py: 1 }}>
            {searching ? `Nada encontrado para "${query.trim()}"` : 'Nenhum item neste filtro'}
          </Typography>
        )}
      </Box>

      {!collapsed && (
        <ContainerFooter testId="control-panel-footer">
          <span>
            <Box component="span" data-testid="control-panel-footer-count" sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, fontWeight: 500, color: 'text.primary', fontVariantNumeric: 'tabular-nums' })}>
              {filtered ? tree.shown : tree.grandTotal}
            </Box>
            {footerTail}
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
      {/* Hooks have no workspace scoping: a new one is always Global's. */}
      {hookEditorOpen && <HookEditorDialog open mode="create" scope="personal" onClose={() => setHookEditorOpen(false)} onSaved={() => undefined} />}
      <PluginImportDialog
        open={pluginImportOpen}
        scope={isHome ? 'personal' : 'project'}
        onClose={() => setPluginImportOpen(false)}
        onSuccess={() => {
          setPluginImportOpen(false);
          void qc.invalidateQueries({ queryKey: pluginsQueryKey('personal') });
          void qc.invalidateQueries({ queryKey: pluginsQueryKey('project') });
          void qc.invalidateQueries({ queryKey: ['entity'] });
          void invalidateHealth(qc);
        }}
      />
      <Toast toast={undo.toast} durationMs={UNDO_DELETE_WINDOW_MS} onDismiss={undo.dismissToast} />
    </Box>
  );
}
