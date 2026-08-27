import { useState } from 'react';
import {
  Box, Button, Container, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Stack,
} from '@mui/material';
import { Plus, Pencil, Trash2, Copy, Sparkles } from 'lucide-react';
import { Icon } from './ds/Icon.js';
import { ScreenHeader } from './ds/ScreenHeader.js';
import { EmptyState } from './ds/EmptyState.js';
import { callIpc, IpcCallError } from '../lib/ipc.js';
import { Toast, type ToastMessage } from './Toast.js';
import { PluginOriginBadge } from './PluginOriginBadge.js';
import { CustomizationEditor } from './CustomizationEditor.js';
import { CustomizationViewDrawer } from './CustomizationViewDrawer.js';
import { EntityDataGrid } from './EntityDataGrid/index.js';
import type { EntityDef, RowAction } from './EntityDataGrid/index.js';
import { useCustomizationList, useInvalidateCustomization } from '../hooks/use-customization-list.js';
import { useProjects } from '../hooks/use-projects.js';
import type { Agent, Entity, Skill } from '../../shared/entity.js';
import type { Project } from '../../shared/project.js';
import { blankCustomization } from '../lib/blank-customization.js';

interface CustomizationListScreenProps {
  entityType: 'skill' | 'agent';
  title: string;
  singular: string;
  gender: 'f' | 'm';
  listMethod: string;
  deleteMethod: string;
  /** Optional one-line context shown under the screen title. */
  subtitle?: React.ReactNode;
  /** Optional teaching copy shown in the empty state, under its title. */
  emptyDescription?: React.ReactNode;
}

type Editor =
  | { kind: 'closed' }
  | { kind: 'create'; customization: Skill | Agent }
  | { kind: 'edit'; customization: Skill | Agent };

export function CustomizationListScreen({
  entityType, title, singular, gender, listMethod, deleteMethod, subtitle, emptyDescription,
}: CustomizationListScreenProps): React.ReactElement {
  const { data, isLoading, error } = useCustomizationList(entityType, listMethod);
  const invalidate = useInvalidateCustomization();
  const { data: projects = [] } = useProjects();

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [editor, setEditor] = useState<Editor>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<Entity | null>(null);
  const [viewing, setViewing] = useState<Entity | null>(null);

  const items = data ?? [];

  const handleSaved = async (saved: Skill | Agent): Promise<void> => {
    // Stay in the editor with the saved entity instead of bouncing back to the
    // list — a brand-new item only gets a real urn once saved, and closing
    // here would strand the user right when the Session panel becomes usable.
    setEditor({ kind: 'edit', customization: saved });
    setToast({ variant: 'success', message: `${saved.name} salvo` });
    await invalidate(entityType);
  };

  const handleDeleteConfirmed = async (): Promise<void> => {
    if (!confirmDelete) return;
    try {
      await callIpc(deleteMethod, { id: confirmDelete.name, removeSymlinks: true });
      setToast({ variant: 'success', message: `${confirmDelete.name} removido` });
      await invalidate(entityType);
    } catch (err) {
      const message = err instanceof IpcCallError ? err.message : String(err);
      setToast({ variant: 'error', message });
    } finally {
      setConfirmDelete(null);
    }
  };

  if (editor.kind !== 'closed') {
    return (
      <CustomizationEditor
        initial={editor.customization}
        isCreate={editor.kind === 'create'}
        onSaved={(saved) => handleSaved(saved as Skill | Agent)}
        onCancel={() => setEditor({ kind: 'closed' })}
      />
    );
  }

  const startCreate = (): void =>
    setEditor({ kind: 'create', customization: blankCustomization(entityType) as Skill | Agent });

  const entity: EntityDef<Entity> = {
    name: entityType,
    pluralName: `${singular}s`,
    getKey: (item) => `${item.source.kind}/${item.urn}`,
    fields: [
      {
        key: 'name',
        label: 'Name',
        primary: true,
        searchable: true,
        render: (item, view) =>
          view === 'card' && item.source.kind === 'plugin' ? (
            <Stack direction="row" sx={{ alignItems: 'center' }}>
              <Box component="span">{item.name}</Box>
              <PluginOriginBadge
                pluginId={item.source.pluginId}
                {...(item.source.provenance ? { provenance: item.source.provenance } : {})}
              />
            </Stack>
          ) : (
            item.name
          ),
      },
      {
        key: 'plugin',
        label: 'Plugin',
        hideInCard: true,
        width: 160,
        render: (item) =>
          item.source.kind === 'plugin' ? (
            <PluginOriginBadge
              pluginId={item.source.pluginId}
              {...(item.source.provenance ? { provenance: item.source.provenance } : {})}
            />
          ) : null,
      },
      {
        key: 'scope',
        label: 'Scope',
        badge: true,
        render: (item) => scopeLabel(item, projects),
      },
      { key: 'description', label: 'Description', secondary: true, searchable: true },
    ],
  };

  const isWorkspace = (item: Entity): boolean => item.source.kind === 'workspace';

  const actions: RowAction<Entity>[] = [
    {
      label: 'Editar',
      icon: <Icon glyph={Pencil} size={16} />,
      hidden: (item) => !isWorkspace(item),
      onClick: (item) => setEditor({ kind: 'edit', customization: item as Skill | Agent }),
    },
    {
      label: 'Duplicar',
      icon: <Icon glyph={Copy} size={16} />,
      hidden: (item) => !isWorkspace(item),
      onClick: (item) => setEditor({ kind: 'create', customization: duplicateCustomization(item as Skill | Agent, items) }),
    },
    {
      label: 'Excluir',
      icon: <Icon glyph={Trash2} size={16} />,
      variant: 'destructive',
      hidden: (item) => !isWorkspace(item),
      onClick: (item) => setConfirmDelete(item),
    },
  ];

  return (
    <Container component="main" data-testid={`entity-list-${entityType}`} maxWidth="lg" sx={{ py: 2.5 }}>
      <ScreenHeader
        kicker="Workspace"
        title={title}
        subtitle={subtitle}
        actions={
          <Button variant="contained" startIcon={<Icon glyph={Plus} size={16} />} onClick={startCreate} data-testid={`new-${entityType}-button`}>
            Novo
          </Button>
        }
      />

      <EntityDataGrid<Entity>
        entity={entity}
        data={items}
        isLoading={isLoading}
        error={error}
        actions={actions}
        onRowClick={(item) => setViewing(item)}
        searchPlaceholder={`Buscar ${singular}s…`}
        emptyState={
          <EmptyState
            glyph={Sparkles}
            title={`Nenhum${gender === 'f' ? 'a' : ''} ${singular} ainda`}
            description={emptyDescription}
            cta={
              <Button variant="outlined" startIcon={<Icon glyph={Plus} size={16} />} onClick={startCreate}>
                Criar {singular}
              </Button>
            }
            testId={entityType}
          />
        }
      />

      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} aria-label="Confirmar exclusão" data-testid="confirm-delete-dialog">
        <DialogTitle>Confirmar exclusão</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remover <strong>{confirmDelete?.name}</strong>?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancelar</Button>
          <Button variant="contained" color="error" onClick={handleDeleteConfirmed}>Confirmar</Button>
        </DialogActions>
      </Dialog>

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <CustomizationViewDrawer
        entity={viewing}
        onClose={() => setViewing(null)}
        onEdit={(item) => {
          setViewing(null);
          setEditor({ kind: 'edit', customization: item as Skill | Agent });
        }}
      />
    </Container>
  );
}

function scopeLabel(item: Entity, projects: Project[]): string {
  const scope = item.scopes[0];
  if (scope === 'workspace') return 'Workspace';
  if (scope === 'project') {
    return projects.find((p) => p.id === item.scopeId)?.name ?? item.scopeId ?? 'Project';
  }
  return 'Personal';
}

function duplicateCustomization(source: Skill | Agent, siblings: Entity[]): Skill | Agent {
  const taken = new Set(siblings.map((a) => a.name));
  const base = source.name;
  let candidate = `${base}-copy`;
  let i = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-copy-${i}`;
    i++;
  }
  return { ...source, urn: '', name: candidate, metadata: { ...source.metadata, createdAt: '', updatedAt: '' } };
}
