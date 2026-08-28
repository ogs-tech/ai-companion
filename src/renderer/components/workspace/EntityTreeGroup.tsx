import { useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { Pencil, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { StatusPill } from '../ds/StatusPill.js';
import { PluginOriginBadge } from '../PluginOriginBadge.js';
import { CustomizationEditor } from '../CustomizationEditor.js';
import { CustomizationViewDrawer } from '../CustomizationViewDrawer.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { ENTITY_GROUP_ICONS } from '../shell/nav.js';
import { useCustomizationList, useInvalidateCustomization } from '../../hooks/use-customization-list.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import { Toast, type ToastMessage } from '../Toast.js';
import type { Agent, Entity, Skill } from '../../../shared/entity.js';

interface LocalScope {
  scope: 'workspace' | 'project';
  scopeId: string;
}

interface EntityTreeGroupProps {
  kind: 'skill' | 'agent';
  label: string;
  /** Omitted at the Default/personal workspace — there, nothing is "more global" than this, so every item shows unfiltered. */
  localScope?: LocalScope;
  /** Whether entities that don't belong to `localScope` are currently visible. Ignored when `localScope` is omitted. */
  showGlobal: boolean;
}

type Editor = { kind: 'closed' } | { kind: 'create' | 'edit'; entity: Skill | Agent };

function isLocal(entity: Entity, localScope: LocalScope | undefined): boolean {
  if (!localScope) return true;
  return entity.scopes[0] === localScope.scope && entity.scopeId === localScope.scopeId;
}

export function EntityTreeGroup({ kind, label, localScope, showGlobal }: EntityTreeGroupProps): React.ReactElement {
  const { data } = useCustomizationList(kind, `${kind}.list`);
  const invalidate = useInvalidateCustomization();
  const items = data ?? [];

  const [editor, setEditor] = useState<Editor>({ kind: 'closed' });
  const [viewing, setViewing] = useState<Entity | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const localItems = items.filter((item) => isLocal(item, localScope));
  const globalItems = localScope && showGlobal ? items.filter((item) => !isLocal(item, localScope)) : [];
  const visible = [...localItems, ...globalItems].sort((a, b) => a.name.localeCompare(b.name));

  const startCreate = (): void => {
    const blank = blankCustomization(kind) as Skill | Agent;
    const seeded = localScope
      ? ({ ...blank, scopes: [localScope.scope], scopeId: localScope.scopeId } as Skill | Agent)
      : blank;
    setEditor({ kind: 'create', entity: seeded });
  };

  const handleDelete = async (item: Entity): Promise<void> => {
    if (!window.confirm(`Remover ${item.name}?`)) return;
    try {
      await callIpc(`${kind}.delete`, { id: item.name, removeSymlinks: true });
      await invalidate(kind);
      setToast({ variant: 'success', message: `${item.name} removido` });
    } catch (err) {
      setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
    }
  };

  if (editor.kind !== 'closed') {
    return (
      <CustomizationEditor
        initial={editor.entity}
        isCreate={editor.kind === 'create'}
        onSaved={async (saved) => {
          setEditor({ kind: 'edit', entity: saved as Skill | Agent });
          await invalidate(kind);
          setToast({ variant: 'success', message: `${saved.name} salvo` });
        }}
        onCancel={() => setEditor({ kind: 'closed' })}
      />
    );
  }

  return (
    <>
      <TreeGroup
        testId={kind}
        glyph={ENTITY_GROUP_ICONS[kind]}
        label={label}
        count={visible.length}
        onCreate={startCreate}
        createLabel={`Novo ${kind === 'skill' ? 'skill' : 'agent'}`}
      >
        {visible.map((item) => {
          const global = !isLocal(item, localScope);
          return (
            <TreeGroupRow
              key={item.urn}
              testId={`tree-${kind}-${item.name}`}
              glyph={ENTITY_GROUP_ICONS[kind]}
              primary={item.name}
              muted={global}
              onClick={() => setViewing(item)}
              badge={
                item.source.kind === 'plugin' ? (
                  <PluginOriginBadge pluginId={item.source.pluginId} provenance={item.source.provenance} />
                ) : global ? (
                  <StatusPill variant="idle" label="Global" testId={`${kind}-global-${item.name}`} />
                ) : undefined
              }
              actions={
                item.source.kind === 'workspace' ? (
                  <Box sx={{ display: 'flex', gap: 0.25 }}>
                    <Tooltip title="Editar">
                      <Box
                        component="span"
                        role="button"
                        tabIndex={0}
                        aria-label={`Editar ${item.name}`}
                        data-testid={`tree-${kind}-edit-${item.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditor({ kind: 'edit', entity: item as Skill | Agent });
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          if (e.key === ' ') e.preventDefault();
                          e.stopPropagation();
                          setEditor({ kind: 'edit', entity: item as Skill | Agent });
                        }}
                        sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
                      >
                        <Icon glyph={Pencil} size={14} />
                      </Box>
                    </Tooltip>
                    <Tooltip title="Excluir">
                      <Box
                        component="span"
                        role="button"
                        tabIndex={0}
                        aria-label={`Excluir ${item.name}`}
                        data-testid={`tree-${kind}-delete-${item.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(item);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          if (e.key === ' ') e.preventDefault();
                          e.stopPropagation();
                          void handleDelete(item);
                        }}
                        sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
                      >
                        <Icon glyph={Trash2} size={14} />
                      </Box>
                    </Tooltip>
                  </Box>
                ) : undefined
              }
            />
          );
        })}
      </TreeGroup>
      <CustomizationViewDrawer
        entity={viewing}
        onClose={() => setViewing(null)}
        onEdit={(item) => {
          setViewing(null);
          setEditor({ kind: 'edit', entity: item as Skill | Agent });
        }}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
