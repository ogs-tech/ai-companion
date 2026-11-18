import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Divider,
  IconButton,
  InputBase,
  List,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { Plus, Search, X } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { ContainerHeader, FooterLink } from '../ds/ContainerChrome.js';
import { EntityTreeRow, seedNewEntity, type EntityRowHandlers } from './EntityTreeRow.js';
import { DetectedTreeRow } from './DetectedTreeRow.js';
import { HookTreeRow } from './HookTreeRow.js';
import { InstructionTreeRow } from './InstructionTreeRow.js';
import { McpTreeRow } from './McpTreeRow.js';
import { PluginTreeRow } from './PluginTreeRow.js';
import { PersistedGroup } from './TreeGroup.js';
import { TreeFilterChips } from './TreeFilterChips.js';
import { ScopeSection } from './ScopeSection.js';
import { useCustomizationTree } from '../../hooks/use-customization-tree.js';
import { McpEditorDialog } from '../../screens/mcps/McpEditorDialog.js';
import { HookEditorDialog } from '../../screens/hooks/HookEditorDialog.js';
import { CUSTOMIZATION_KINDS } from '../../../shared/customization-kind.js';
import { PluginImportDialog } from '../../screens/plugins/PluginImportDialog.js';
import { usePersonalInstruction, useInstructionsList } from '../../hooks/use-instructions.js';
import { pluginsQueryKey } from '../../hooks/use-plugins.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import type { TreeFilter, TreeGroup, TreeItem, TreeSection } from '../../lib/customization-tree.js';
import type { Agent, Instruction, Skill } from '../../../shared/entity.js';
import { invalidateHealth } from '../../hooks/use-health-report.js';
import {
  UNDO_DELETE_WINDOW_MS,
  UndoableDeleteContext,
  useUndoableDelete,
} from '../../hooks/use-undoable-delete.js';
import { Toast } from '../Toast.js';
import type { ChannelId } from '../../../shared/channel.js';

interface LocalScope {
  scope: 'workspace';
  scopeId: string;
}

type EntityKind = 'skill' | 'agent';

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
  /** Collapses the container to its header. Owned by the panel split, which sizes the container. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

type NewTarget = EntityKind | 'instruction' | 'mcp' | 'hook' | 'plugin';

/**
 * Every customization of the current scope: its instruction row(s) ("Instruções") first, then one group per type
 * (Skills, Agents, MCP, Hooks, Plugins) — a type with nothing in it is left out. Inside a workspace the workspace's
 * own groups come first, then a Global section (Início's items, editable here too, collapsed by default). Each row
 * shows one signal at most (`RowSignal`: a channel mark with a badge, or a quiet word) and acts only through its menu
 * (⋯ or right-click). Detected items stay in their groups, receded, and are not counted. The `N com erro` chip (plus a
 * channel row) filters by status and combines with the search. The tree comes from one pure model
 * (`buildCustomizationTree`), so every count equals the app's own items the list shows.
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

  const instructionCreatable = isHome
    ? !personalInstruction
    : seedWorkspaceInstruction !== undefined;
  const create = (target: NewTarget): void => {
    setNewMenuAnchor(null);
    if (target === 'skill' || target === 'agent')
      onEditEntity(target, seedNewEntity(target, localScope), true);
    else if (target === 'instruction') {
      onOpenInstruction(
        isHome ? (blankCustomization('instruction') as Instruction) : seedWorkspaceInstruction!(),
        true,
      );
    } else if (target === 'mcp') setMcpEditorOpen(true);
    else if (target === 'hook') setHookEditorOpen(true);
    else setPluginImportOpen(true);
  };
  // One entry per kind, in the registry's (= the tree's) order; a plugin is an origin, so it is imported, not created.
  const menuTargets: ReadonlyArray<{ target: NewTarget; label: string }> = [
    ...CUSTOMIZATION_KINDS.filter((k) => k.kind !== 'instruction' || instructionCreatable).map(
      (k) => ({ target: k.kind, label: k.label }),
    ),
    { target: 'plugin', label: 'Importar plugin' },
  ];
  const handleNew = (e: React.MouseEvent<HTMLElement>): void => setNewMenuAnchor(e.currentTarget);

  const entityHandlers: EntityRowHandlers = {
    onEdit: onEditEntity,
    onPreview: onPreviewEntity,
    onProperties: onEntityProperties,
    onNewAction: onNewActionForEntity,
  };
  const instructionNames = new Set((instructions ?? []).map((i) => i.name));

  const instructionRow = (item: TreeItem, depth: number): React.ReactNode => {
    if (item.entity.kind !== 'instruction' || undo.pendingKeys.has(item.urn)) return null;
    const { value, placement, folder, detected } = item.entity;
    const shared = {
      key: item.key,
      item,
      depth,
      instruction: value,
      detected,
      onPreview: onPreviewEntity,
    };
    if (placement === 'personal') {
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
    const seed =
      placement === 'folder'
        ? folder !== undefined && seedFolderInstruction
          ? () => seedFolderInstruction(folder, instructionNames)
          : undefined
        : seedWorkspaceInstruction;
    if (value === undefined && seed === undefined) return null;
    return (
      <InstructionTreeRow
        {...shared}
        kind={placement}
        testId={
          placement === 'folder'
            ? `folder-instruction-row-${item.folderAlias ?? folder ?? ''}`
            : value
              ? `workspace-instruction-row-${value.name}`
              : 'workspace-instruction-row'
        }
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
    if (group.id === 'mcp')
      for (const item of group.items) mcpNames.set(item.name, (mcpNames.get(item.name) ?? 0) + 1);
    return group.items
      .filter((item) => !undo.pendingKeys.has(item.urn))
      .map((item) => itemRow(item, depth, (mcpNames.get(item.name) ?? 0) > 1));
  };

  const itemRow = (item: TreeItem, depth: number, showMcpScope = false): React.ReactNode => {
    switch (item.entity.kind) {
      case 'instruction':
        return instructionRow(item, depth);
      case 'skill':
      case 'agent':
        return <EntityTreeRow key={item.key} item={item} handlers={entityHandlers} depth={depth} />;
      case 'detected':
        return <DetectedTreeRow key={item.key} item={item} depth={depth} />;
      case 'mcp':
        return <McpTreeRow key={item.key} item={item} showScope={showMcpScope} depth={depth} />;
      case 'hook':
        return <HookTreeRow key={item.key} item={item} depth={depth} />;
      case 'plugin':
        return (
          <PluginTreeRow
            key={item.key}
            item={item}
            depth={depth}
            forceOpen={filtered}
            renderChild={(child, d) => itemRow(child, d)}
          />
        );
    }
  };

  const scopeKey = localScope?.scopeId ?? 'home';
  const isEmpty = filtered && tree.matched === 0;
  const isBlank = !filtered && tree.matched === 0;
  // Inside a workspace, Global's items follow the workspace's own under their own header.
  const sectioned = !isHome && localScope !== undefined;
  const localSection = tree.sections.find((s) => s.id === 'local');
  const globalSection = tree.sections.find((s) => s.id === 'global');
  const showGlobal = sectioned && globalSection !== undefined && !isEmpty && !(filtered && globalSection.rows === 0);
  const localVisible = localSection !== undefined && !(filtered && localSection.rows === 0);
  /** A section's body: its instruction row(s) right under it, ungrouped, then one collapsible group per type. */
  const sectionBody = (section: TreeSection, base: number): React.ReactNode =>
    section.groups.map((group) => {
      if (group.id === 'instruction') return groupRows(group, base);
      // An empty type is noise; "+" is where a new one starts.
      if (group.items.length === 0) return null;
      const id = section.id === 'global' ? `global-${group.id}` : group.id;
      return (
        <PersistedGroup
          key={group.id}
          id={id}
          label={group.label}
          count={group.count}
          problems={group.problems}
          storageKey={`tree-group:${scopeKey}:${section.id}:${group.id}`}
          forceOpen={filtered}
          depth={base}
          defaultOpen
        >
          {groupRows(group, base + 1)}
        </PersistedGroup>
      );
    });
  const rows = (
    <List disablePadding>
      {localSection && (
        <Box {...(sectioned ? { 'data-testid': 'control-panel-section-local' } : {})} sx={localVisible ? {} : { display: 'none' }}>
          {sectionBody(localSection, 0)}
        </Box>
      )}
      {showGlobal && (
        <>
          {localVisible && localSection.rows > 0 && <Divider sx={{ mx: 1.5, mt: 1, mb: 0.5 }} />}
          <ScopeSection
            section="global"
            label="Global"
            caption="vale para todos os workspaces"
            tooltip="Itens do Início. Uma alteração aqui vale para todos os workspaces."
            count={globalSection.count}
            storageKey={`scope-section:${scopeKey}:global`}
            forceOpen={filtered}
            defaultOpen={false}
          >
            {sectionBody(globalSection, 1)}
          </ScopeSection>
        </>
      )}
    </List>
  );

  return (
    <Box
      data-testid="control-panel-customizations"
      sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <ContainerHeader
        title="Customizações"
        testId="control-panel"
        collapsed={collapsed}
        onToggle={() => onToggleCollapsed?.()}
        {...(filtered
          ? {
              status: (
                <Typography
                  component="span"
                  data-testid="control-panel-shown"
                  sx={{ fontSize: '0.75rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                >
                  {tree.shown} de {tree.grandTotal}
                </Typography>
              ),
            }
          : { count: tree.grandTotal })}
        actions={
          <Tooltip title="Nova customização">
            <IconButton
              size="small"
              aria-label="Nova customização"
              data-testid="control-panel-new"
              onClick={handleNew}
              sx={(theme) => ({
                width: 26,
                height: 26,
                borderRadius: `${theme.ogs.radius.xs}px`,
                bgcolor: theme.ogs.surfaces.rail,
                color: 'text.primary',
                '&:hover': { bgcolor: theme.palette.action.hover },
              })}
            >
              <Icon glyph={Plus} size={14} />
            </IconButton>
          </Tooltip>
        }
      />
      <Stack
        spacing={1}
        sx={{ px: 1.5, pb: 1, flexShrink: 0, ...(collapsed ? { display: 'none' } : {}) }}
      >
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Box
            sx={(theme) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              flexGrow: 1,
              minWidth: 0,
              height: 28,
              px: 1,
              color: 'text.secondary',
              bgcolor: theme.ogs.surfaces.input,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: `${theme.ogs.radius.xs}px`,
              '&:focus-within': { borderColor: theme.palette.secondary.main },
            })}
          >
            <Icon glyph={Search} size={14} />
            <InputBase
              fullWidth
              placeholder="Buscar"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputProps={{
                'aria-label': 'Buscar customizações',
                'data-testid': 'control-panel-search',
              }}
              sx={{ fontSize: '0.8125rem', color: 'text.primary' }}
            />
            {searching && (
              <IconButton
                size="small"
                aria-label="Limpar busca"
                data-testid="control-panel-search-clear"
                onClick={() => setQuery('')}
                sx={{ p: 0.25 }}
              >
                <Icon glyph={X} size={12} />
              </IconButton>
            )}
          </Box>
        </Stack>
        <TreeFilterChips
          value={filter}
          channel={channel}
          totals={tree.totals}
          onChange={setFilter}
          onChannelChange={setChannel}
        />
      </Stack>

      <Box
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', ...(collapsed ? { display: 'none' } : {}) }}
      >
        <UndoableDeleteContext.Provider value={undo.requestDelete}>
          {rows}
        </UndoableDeleteContext.Provider>

        {isEmpty && (
          <Stack spacing={0.75} data-testid="control-panel-empty" sx={{ px: 1.75, py: 1.5, alignItems: 'flex-start' }}>
            <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>
              {searching ? `Nada encontrado para "${query.trim()}".` : 'Nenhum item neste filtro.'}
            </Typography>
            <Typography component="div" sx={{ fontSize: '0.8125rem' }}>
              <FooterLink testId="control-panel-clear" onClick={clearFilters}>
                Limpar filtros
              </FooterLink>
            </Typography>
          </Stack>
        )}
        {isBlank && (
          <Typography data-testid="control-panel-blank" sx={{ px: 1.75, py: 1.5, fontSize: '0.8125rem', color: 'text.secondary' }}>
            Nenhuma customização ainda. Use + para criar a primeira.
          </Typography>
        )}
      </Box>

      <Menu
        anchorEl={newMenuAnchor}
        open={newMenuAnchor !== null}
        onClose={() => setNewMenuAnchor(null)}
      >
        {menuTargets.map(({ target, label }) => (
          <MenuItem
            key={target}
            data-testid={`control-panel-new-${target}`}
            onClick={() => create(target)}
          >
            {label}
          </MenuItem>
        ))}
      </Menu>
      {mcpEditorOpen && (
        <McpEditorDialog open mode="create" onClose={() => setMcpEditorOpen(false)} />
      )}
      {/* Hooks have no workspace scoping: a new one is always Global's. */}
      {hookEditorOpen && (
        <HookEditorDialog
          open
          mode="create"
          scope="personal"
          onClose={() => setHookEditorOpen(false)}
          onSaved={() => undefined}
        />
      )}
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
