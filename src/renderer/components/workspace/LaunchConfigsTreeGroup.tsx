import { useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { FolderSearch, NotebookPen, Play, Square } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { LaunchProcessStatusBadge } from '../LaunchProcessStatusBadge.js';
import { useProjectLaunchConfigs } from '../../hooks/use-launch-configs.js';
import { useRunLaunchConfig, useKillLaunchProcess, useLaunchProcesses } from '../../hooks/use-launch-process.js';
import { useRevealPath } from '../../hooks/use-open-with.js';
import { IpcCallError } from '../../lib/ipc.js';
import type { LaunchProcessSnapshot } from '../../../shared/launch-config.js';
import type { Project } from '../../../shared/project.js';

const LAUNCH_JSON_REL_PATH = '.vscode/launch.json';

interface LaunchConfigsTreeGroupProps {
  project: Project;
  /** See `TreeGroup`'s own `depth` — omitted (0) for the workspace-root's pinned copy, `depth+1` when nested under a matched child Project's own folder. */
  depth?: number;
  onOpenProcess: (process: LaunchProcessSnapshot) => void;
  onEditLaunchJson: (project: Project) => void;
}

/**
 * One Project's own "Launch Configurations" group — used both nested under
 * its matched folder in `FolderTree` (via `renderProjectLaunchConfigsRow`)
 * and, for the workspace-root Project, pinned once at the top via
 * `FolderTree`'s `pinnedRows` slot (see the design spec's §3.9 for why the
 * root case can't reuse the nested call site without duplicating).
 */
export function LaunchConfigsTreeGroup({ project, depth = 0, onOpenProcess, onEditLaunchJson }: LaunchConfigsTreeGroupProps): React.ReactElement | null {
  const entry = useProjectLaunchConfigs(project.id);
  const processes = useLaunchProcesses();
  const runConfig = useRunLaunchConfig();
  const killProcess = useKillLaunchProcess();
  const revealPath = useRevealPath();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<Project>();

  if (!entry || (entry.configs.length === 0 && entry.error === undefined)) return null;

  const rowMenuActions: RowContextMenuAction[] = rowMenu.state
    ? [
        { key: 'edit-launch-json', label: 'Edit launch.json', glyph: NotebookPen, onSelect: () => onEditLaunchJson(project) },
        {
          key: 'reveal',
          label: 'Reveal in Finder',
          glyph: FolderSearch,
          onSelect: () => {
            revealPath
              .mutateAsync({ relPath: LAUNCH_JSON_REL_PATH, kind: 'file', projectId: project.id })
              .catch((err: unknown) => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) }));
          },
        },
      ]
    : [];

  const latestProcessFor = (configName: string): LaunchProcessSnapshot | undefined => {
    const matches = processes.filter((p) => p.projectId === project.id && p.configName === configName);
    return matches[matches.length - 1];
  };

  return (
    <>
      <TreeGroup
        testId={`launch-configs-${project.name}`}
        glyph={Play}
        label="Launch Configurations"
        depth={depth}
        {...(entry.error === undefined ? { count: entry.configs.length } : {})}
      >
        {entry.error ? (
          <Box sx={{ px: 1.5, py: 0.75, fontSize: '0.75rem', opacity: 0.75 }} data-testid={`launch-configs-error-${project.name}`}>
            {entry.error}
          </Box>
        ) : (
          entry.configs.map((config) => {
            const process = latestProcessFor(config.name);
            const running = process?.status === 'running';
            const row = (
              <TreeGroupRow
                key={config.name}
                testId={`tree-launch-config-${project.name}-${config.name}`}
                glyph={Play}
                primary={config.name}
                muted={!config.supported}
                depth={depth}
                onContextMenu={(e) => rowMenu.openMenu(e, project)}
                {...(config.supported
                  ? {
                      onClick: () => {
                        if (running && process) {
                          onOpenProcess(process);
                        } else {
                          runConfig.mutate({ projectId: project.id, configName: config.name }, { onSuccess: onOpenProcess });
                        }
                      },
                    }
                  : { disabled: true })}
                badge={<LaunchProcessStatusBadge status={process?.status} testId={`${project.name}-${config.name}`} />}
                actions={
                  running && process ? (
                    <Tooltip title="Parar">
                      <Box
                        component="span"
                        role="button"
                        tabIndex={0}
                        aria-label={`Parar ${config.name}`}
                        data-testid={`tree-launch-config-stop-${project.name}-${config.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          killProcess.mutate(process.processId);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          if (e.key === ' ') e.preventDefault();
                          e.stopPropagation();
                          killProcess.mutate(process.processId);
                        }}
                        sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
                      >
                        <Icon glyph={Square} size={13} />
                      </Box>
                    </Tooltip>
                  ) : undefined
                }
              />
            );
            return config.supported ? (
              row
            ) : (
              <Tooltip key={config.name} title={`Tipo '${config.type}'/request '${config.request}' não suportado — só node/launch pode ser executado`}>
                <span>{row}</span>
              </Tooltip>
            );
          })
        )}
      </TreeGroup>
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={rowMenuActions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
