import { useState } from 'react';
import { Tooltip, Typography } from '@mui/material';
import { Download, Trash2, Webhook } from 'lucide-react';
import { ChannelWarning } from '../ds/ChannelWarning.js';
import { useEntityHealth } from '../../hooks/use-entity-health.js';
import { entityUrn } from '../../../shared/entity.js';
import { countProblems } from '../../lib/entity-health.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { OriginGroups, type OriginView } from './OriginGroups.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { useDeleteHook, useHooks, type Hook } from '../../hooks/use-hooks.js';
import { useImportDetected } from '../../hooks/use-detected.js';
import { HARNESS_LABEL } from './DetectedTreeGroup.js';
import { describeHookHandler, hookRowLabel } from '../../lib/describe-hook-handler.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { IpcCallError } from '../../lib/ipc.js';
import { matchesOrigin, matchesQuery, useReportCount, type OriginSegment } from '../../lib/control-panel-filter.js';

interface HooksTreeGroupProps {
  /** Hooks have no project/workspace scoping today — everything is the "global" tier. Omitted at the Default workspace, where nothing is filtered. */
  isProjectContext?: boolean;
  showGlobal: boolean;
  /** Rows only, no group header — see `TreeGroup`'s `flat`. */
  flat?: boolean;
  /** Keeps only hooks whose handler description contains this text. */
  query?: string;
  /** Keeps only the user's own or only plugin-provided hooks. Defaults to both. */
  origin?: OriginSegment;
  /** Reports the number of rows this list renders. */
  onCount?: (count: number) => void;
  /** Reports how many of the rows have a problem in some channel. */
  onProblems?: (count: number) => void;
  /** Row indent of the group header — see `TreeGroup`'s `depth`. */
  depth?: number;
  /** Starts expanded — see `TreeGroup`'s `defaultExpanded`. */
  defaultExpanded?: boolean;
  /** Takes part in a cross-type origin view — see `OriginView`. */
  view?: OriginView;
}

/** Hooks are personal-only (no `scopeId`) — inside a project workspace they only show once "Mostrar entidades globais" is on, since none of them are local to begin with. */
export function HooksTreeGroup({ isProjectContext, showGlobal, flat = false, query = '', origin = 'all', onCount, onProblems, depth = 0, defaultExpanded = false, view }: HooksTreeGroupProps): React.ReactElement {
  const { data } = useHooks();
  const del = useDeleteHook();
  const importer = useImportDetected();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<Hook>();
  const rowMenuTarget = rowMenu.state?.target;
  const rowMenuActions: RowContextMenuAction[] = !rowMenuTarget
    ? []
    : rowMenuTarget.source.kind === 'detected'
      ? [{ key: 'import', label: 'Importar', glyph: Download, onSelect: () => importer.mutate({ id: (rowMenuTarget.source as { detectedId: string }).detectedId }, { onError: onMutationError }) }]
      : [{ key: 'delete', label: 'Excluir', glyph: Trash2, danger: true, onSelect: () => handleDelete(rowMenuTarget.id, describeHookHandler(rowMenuTarget.handler)) }];
  const onMutationError = (err: unknown): void => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
  const items = (isProjectContext && !showGlobal ? [] : (data ?? [])).filter((h) => matchesOrigin(origin, h.source.kind === 'plugin') && matchesQuery(query, describeHookHandler(h.handler), h.event))
    .sort((a, b) => hookRowLabel(a).localeCompare(hookRowLabel(b)));
  const health = useEntityHealth();
  // A hook the harness cannot express is not a fault, and no check is emitted for it (`skip` destination).
  const problems = countProblems(health, items.map((h) => entityUrn('hook', h.id)));
  useReportCount(items.length, onCount);
  useReportCount(problems, onProblems);

  const handleDelete = (hookId: string, label: string): void => {
    if (!window.confirm(`Remover hook "${label}"?`)) return;
    const hook = (data ?? []).find((h) => h.id === hookId);
    if (!hook) return;
    del.mutate(hook, {
      onError: (err) => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) }),
    });
  };

  return (
    <>
      <TreeGroup testId="hook" glyph={Webhook} label="Hooks" count={items.length} problems={problems} depth={depth} defaultExpanded={defaultExpanded} flat={flat}>
        <OriginGroups
          glyph={Webhook}
          items={items}
          storageScope={`${isProjectContext ? 'ws' : 'home'}:hook`}
          testId="hook"
          forceOpen={query.trim() !== ''}
          depth={flat ? depth : depth + 1}
          plainDepth={depth}
          {...(view ? { view } : {})}
          renderRow={(item, depth) => (
            <TreeGroupRow
              key={item.id}
              testId={`tree-hook-${item.id}`}
              glyph={Webhook}
              mono
              depth={depth}
              primary={<Tooltip title={describeHookHandler(item.handler)}><span>{hookRowLabel(item)}</span></Tooltip>}
              badge={
                <>
                  {item.source.kind === 'detected' && (
                    <Typography component="span" noWrap sx={{ flexShrink: 0, fontSize: '0.6875rem', color: 'text.disabled' }}>
                      {HARNESS_LABEL[item.source.harness]}{item.source.importable ? '' : ' · não importável'}
                    </Typography>
                  )}
                  <ChannelWarning urn={entityUrn('hook', item.id)} channels={health.get(entityUrn('hook', item.id)) ?? []} />
                </>
              }
              {...(item.source.kind === 'workspace' || (item.source.kind === 'detected' && item.source.importable)
                ? { onContextMenu: (e: React.MouseEvent) => rowMenu.openMenu(e, item) }
                : {})}
            />
          )}
        />
      </TreeGroup>
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={rowMenuActions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
