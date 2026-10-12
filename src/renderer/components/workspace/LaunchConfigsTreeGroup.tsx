import { useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { FolderSearch, NotebookPen, Play, Square } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { LaunchProcessStatusBadge } from '../LaunchProcessStatusBadge.js';
import { useLaunchConfigs } from '../../hooks/use-launch-configs.js';
import { useRunLaunchConfig, useKillLaunchProcess, useLaunchProcesses } from '../../hooks/use-launch-process.js';
import { useRevealPath } from '../../hooks/use-open-with.js';
import { IpcCallError } from '../../lib/ipc.js';
import type { LaunchProcessSnapshot } from '../../../shared/launch-config.js';
import type { Workspace } from '../../../shared/workspace.js';

const LAUNCH_JSON_REL_PATH = '.vscode/launch.json';

interface LaunchConfigsTreeGroupProps {
  workspace: Workspace;
  /** See `TreeGroup`'s own `depth`. */
  depth?: number;
  onOpenProcess: (process: LaunchProcessSnapshot) => void;
  onEditLaunchJson: () => void;
}

/** The open workspace's "Launch Configurations" group, pinned at the top of its file tree. */
export function LaunchConfigsTreeGroup({ workspace, depth = 0, onOpenProcess, onEditLaunchJson }: LaunchConfigsTreeGroupProps): React.ReactElement | null {
  const { data: entry } = useLaunchConfigs();
  const processes = useLaunchProcesses();
  const runConfig = useRunLaunchConfig();
  const killProcess = useKillLaunchProcess();
  const revealPath = useRevealPath();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<Workspace>();

  if (!entry || (entry.configs.length === 0 && entry.error === undefined)) return null;

  const rowMenuActions: RowContextMenuAction[] = rowMenu.state
    ? [
        { key: 'edit-launch-json', label: 'Edit launch.json', glyph: NotebookPen, onSelect: onEditLaunchJson },
        {
          key: 'reveal',
          label: 'Reveal in Finder',
          glyph: FolderSearch,
          onSelect: () => {
            revealPath
              .mutateAsync({ relPath: LAUNCH_JSON_REL_PATH, kind: 'file' })
              .catch((err: unknown) => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) }));
          },
        },
      ]
    : [];

  const latestProcessFor = (configName: string): LaunchProcessSnapshot | undefined => {
    const matches = processes.filter((p) => p.workspaceId === workspace.id && p.configName === configName);
    return matches[matches.length - 1];
  };

  return (
    <>
      <TreeGroup
        testId={`launch-configs-${workspace.name}`}
        glyph={Play}
        label="Launch Configurations"
        depth={depth}
        {...(entry.error === undefined ? { count: entry.configs.length } : {})}
      >
        {entry.error ? (
          <Box sx={{ px: 1.5, py: 0.75, fontSize: '0.75rem', opacity: 0.75 }} data-testid={`launch-configs-error-${workspace.name}`}>
            {entry.error}
          </Box>
        ) : (
          entry.configs.map((config) => {
            const process = latestProcessFor(config.name);
            const running = process?.status === 'running';
            const row = (
              <TreeGroupRow
                key={config.name}
                testId={`tree-launch-config-${workspace.name}-${config.name}`}
                glyph={Play}
                primary={config.name}
                muted={!config.supported}
                depth={depth}
                onContextMenu={(e) => rowMenu.openMenu(e, workspace)}
                {...(config.supported
                  ? {
                      onClick: () => {
                        if (running && process) {
                          onOpenProcess(process);
                        } else {
                          runConfig.mutate({ configName: config.name }, { onSuccess: onOpenProcess });
                        }
                      },
                    }
                  : { disabled: true })}
                badge={<LaunchProcessStatusBadge status={process?.status} testId={`${workspace.name}-${config.name}`} />}
                actions={
                  running && process ? (
                    <Tooltip title="Parar">
                      <Box
                        component="span"
                        role="button"
                        tabIndex={0}
                        aria-label={`Parar ${config.name}`}
                        data-testid={`tree-launch-config-stop-${workspace.name}-${config.name}`}
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
