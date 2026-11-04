import { useState } from 'react';
import { Box, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Folder, Play, Plus, RotateCw, Square, X } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { SectionAction, SectionHeader } from '../ds/ContainerChrome.js';
import { FolderPickerDialog } from './FolderPickerDialog.js';
import { useLaunchConfigs, useRunLaunchConfig } from '../../hooks/use-launch-configs.js';
import {
  useCreateTerminal,
  useKillTerminal,
  useRemoveTerminal,
  useRestartTerminal,
  useTerminals,
} from '../../hooks/use-terminals.js';
import { IpcCallError } from '../../lib/ipc.js';
import { useFolderRouting } from '../../hooks/use-folder-routing.js';
import { WORKSPACE_ROOT_FOLDER, type TerminalSnapshot } from '../../../shared/terminal.js';

interface TerminalsSectionProps {
  /** Terminals that currently have a canvas tab; the rest are marked `sem aba`. */
  openTerminalIds: ReadonlySet<string>;
  /** Called with a terminal to show in the canvas — a new one, or an existing row clicked. */
  onOpen: (terminal: TerminalSnapshot) => void;
  /** A removed terminal can no longer have a tab. */
  onRemoved: (terminalId: string) => void;
  onEditLaunchJson: () => void;
  onError: (message: string) => void;
  /** Fills the Terminais view instead of sitting as a bounded section under the tree. */
  fill?: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof IpcCallError ? err.message : String(err);
}

function statusDotColor(terminal: TerminalSnapshot): string {
  if (terminal.status === 'running') return 'success.main';
  return terminal.exitCode === 0 || terminal.exitCode === null ? 'text.disabled' : 'error.main';
}

function RowAction({ label, testId, glyph, onClick }: { label: string; testId: string; glyph: typeof Square; onClick: () => void }): React.ReactElement {
  return (
    <Tooltip title={label}>
      <Box
        component="span"
        role="button"
        tabIndex={0}
        aria-label={label}
        data-testid={testId}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          if (e.key === ' ') e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
      >
        <Icon glyph={glyph} size={13} />
      </Box>
    </Tooltip>
  );
}

/**
 * The only list of what is running in the workspace: every shell and every
 * launched configuration is a terminal row here, with the stop/restart/remove
 * actions. Closing a tab never stops anything — this is where that happens.
 */
export function TerminalsSection({ openTerminalIds, onOpen, onRemoved, onEditLaunchJson, onError, fill = false }: TerminalsSectionProps): React.ReactElement {
  const { data: terminals = [] } = useTerminals();
  const routing = useFolderRouting();
  const { data: launch } = useLaunchConfigs();
  const createTerminal = useCreateTerminal();
  const runConfig = useRunLaunchConfig();
  const killTerminal = useKillTerminal();
  const restartTerminal = useRestartTerminal();
  const removeTerminal = useRemoveTerminal();
  // Per-view: a group follows its content (open when it has terminals) until clicked.
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const fail = (err: unknown): void => onError(errorMessage(err));
  const closeMenu = (): void => setMenuAnchor(null);
  // In a multi-folder workspace the picker's paths start with a folder alias; `folder` set explicitly wins (drop-list entries).
  const openShell = (relPath: string, folderOverride?: string): void => {
    const { folder, rel } = folderOverride === undefined ? routing.split(relPath) : { folder: folderOverride, rel: relPath };
    createTerminal.mutate(
      { ...(rel !== '' ? { relCwd: rel } : {}), ...(folder !== undefined ? { folder } : {}) },
      { onSuccess: (terminal) => onOpen(terminal), onError: fail },
    );
  };

  const renderRow = (terminal: TerminalSnapshot): React.ReactElement => (
    <Box
      key={terminal.terminalId}
      data-testid={`terminal-row-${terminal.terminalId}`}
      onClick={() => onOpen(terminal)}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: routing.multi ? 3.5 : 1.5, pr: 0.5, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
    >
      <Box
        data-testid={`terminal-dot-${terminal.terminalId}`}
        sx={(theme) => ({
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          ...(terminal.status === 'exited' && terminal.exitCode === 0
            ? { border: `1.5px solid ${theme.palette.text.disabled}` }
            : { bgcolor: statusDotColor(terminal) }),
        })}
      />
      <Typography component="span" sx={{ fontSize: '0.8rem', fontFamily: (t) => t.ogs.fonts.mono }} noWrap>{terminal.name}</Typography>
      <Typography component="span" sx={{ fontSize: '0.7rem', color: 'text.secondary', flex: 1, minWidth: 0 }} noWrap>
        {/* In a multi-folder workspace the group header already names the folder. */}
        {routing.multi ? terminal.relCwd : terminal.relCwd === '' ? 'raiz' : terminal.relCwd}
      </Typography>
      {terminal.kind === 'launch' && <Typography component="span" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>launch</Typography>}
      {!openTerminalIds.has(terminal.terminalId) && (
        <Typography component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>sem aba</Typography>
      )}
      {terminal.status === 'running' && <Typography component="span" sx={{ fontSize: '0.65rem', color: 'success.main' }}>rodando</Typography>}
      {terminal.status === 'exited' && terminal.exitCode !== null && (
        <Typography component="span" data-testid={`terminal-exit-${terminal.terminalId}`} sx={{ fontSize: '0.65rem', color: terminal.exitCode === 0 ? 'text.secondary' : 'error.main' }}>
          {terminal.exitCode}
        </Typography>
      )}
      {terminal.status === 'running' ? (
        <RowAction
          label={`Parar ${terminal.name}`}
          testId={`terminal-stop-${terminal.terminalId}`}
          glyph={Square}
          onClick={() => killTerminal.mutate(terminal.terminalId, { onError: fail })}
        />
      ) : (
        <>
          <RowAction
            label={`Reiniciar ${terminal.name}`}
            testId={`terminal-restart-${terminal.terminalId}`}
            glyph={RotateCw}
            onClick={() => restartTerminal.mutate(terminal.terminalId, { onSuccess: (terminal) => onOpen(terminal), onError: fail })}
          />
          <RowAction
            label={`Remover ${terminal.name}`}
            testId={`terminal-remove-${terminal.terminalId}`}
            glyph={X}
            onClick={() =>
              removeTerminal.mutate(terminal.terminalId, {
                onSuccess: () => onRemoved(terminal.terminalId),
                onError: fail,
              })
            }
          />
        </>
      )}
    </Box>
  );

  // Multi-folder: one collapsible group per folder (a terminal outside every folder goes under the workspace root).
  const inFolder = (terminal: TerminalSnapshot): string => (routing.folders.includes(terminal.folder) ? terminal.folder : WORKSPACE_ROOT_FOLDER);
  const groups = routing.multi
    ? [
        ...(terminals.some((t) => inFolder(t) === WORKSPACE_ROOT_FOLDER) ? [{ key: WORKSPACE_ROOT_FOLDER, label: 'Raiz do workspace', isFolder: false }] : []),
        ...routing.folders.map((folder) => ({ key: folder, label: routing.aliases[folder] as string, isFolder: true })),
      ]
    : [];

  return (
    <Box data-testid="terminals-section" sx={fill ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : { borderTop: 1, borderColor: 'divider', flexShrink: 0, maxHeight: '45%', display: 'flex', flexDirection: 'column' }}>
      <SectionHeader
        title="Terminais"
        testId="terminals-header"
        count={terminals.length}
        actions={
          <SectionAction label="Novo terminal" testId="terminals-new-menu" glyph={Plus} hasPopup onClick={(anchor) => setMenuAnchor(anchor)} />
        }
      />
      <Box sx={{ overflowY: 'auto', pb: 0.5 }}>
        {terminals.length === 0 && (
          <Typography variant="caption" color="text.secondary" data-testid="terminals-empty" sx={{ display: 'block', px: 1.5, py: 0.75 }}>
            Nenhum terminal aberto
          </Typography>
        )}
        {!routing.multi && terminals.map(renderRow)}
        {routing.multi &&
          terminals.length > 0 &&
          groups.map(({ key, label, isFolder }) => {
            const members = terminals.filter((t) => inFolder(t) === key);
            const open = groupOverrides[key] ?? members.length > 0;
            return (
              <Box key={key} data-testid={`terminal-group-${label}`}>
                <Box
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  data-testid={`terminal-group-header-${label}`}
                  onClick={() => setGroupOverrides((prev) => ({ ...prev, [key]: !open }))}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    setGroupOverrides((prev) => ({ ...prev, [key]: !open }));
                  }}
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 1, pr: 1, py: 0.5, cursor: 'pointer', opacity: members.length > 0 ? 1 : 0.6, '&:hover': { bgcolor: 'action.hover' } }}
                >
                  <Icon glyph={open ? ChevronDown : ChevronRight} size={14} />
                  {isFolder && <Icon glyph={Folder} size={14} />}
                  <Typography component="span" noWrap sx={{ fontSize: '0.8rem' }}>{label}</Typography>
                </Box>
                {open && members.map(renderRow)}
              </Box>
            );
          })}
      </Box>
      <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={closeMenu}>
        {routing.multi ? (
          [
            ...routing.folders.map((folder) => (
              <MenuItem key={folder} data-testid={`terminals-menu-folder-${routing.aliases[folder]}`} onClick={() => { closeMenu(); openShell('', folder); }}>
                Novo terminal em {routing.aliases[folder]}
              </MenuItem>
            )),
            <MenuItem key="__ws" data-testid="terminals-menu-workspace-root" onClick={() => { closeMenu(); openShell('', WORKSPACE_ROOT_FOLDER); }}>
              Novo terminal na raiz do workspace
            </MenuItem>,
          ]
        ) : (
          <MenuItem data-testid="terminals-menu-root" onClick={() => { closeMenu(); openShell(''); }}>Novo terminal na raiz</MenuItem>
        )}
        <MenuItem data-testid="terminals-menu-pick" onClick={() => { closeMenu(); setPickerOpen(true); }}>Novo terminal em…</MenuItem>
        {(launch?.configs ?? []).map((config) => {
          const reason = `Tipo '${config.type}'/request '${config.request}' não suportado — só node/launch pode ser executado`;
          const item = (
            <MenuItem
              key={config.name}
              disabled={!config.supported}
              data-testid={`terminals-menu-launch-${config.name}`}
              onClick={() => {
                closeMenu();
                runConfig.mutate({ configName: config.name, ...(routing.multi ? { folder: routing.folders[0] as string } : {}) }, { onSuccess: (terminal) => onOpen(terminal), onError: fail });
              }}
            >
              <Icon glyph={Play} size={13} />
              <Box component="span" sx={{ ml: 1 }}>{config.name}</Box>
            </MenuItem>
          );
          return config.supported ? item : <Tooltip key={config.name} title={reason}><span>{item}</span></Tooltip>;
        })}
        <MenuItem data-testid="terminals-menu-edit-launch" onClick={() => { closeMenu(); onEditLaunchJson(); }}>Editar launch.json</MenuItem>
      </Menu>
      <FolderPickerDialog
        open={pickerOpen}
        title="Novo terminal em…"
        onClose={() => setPickerOpen(false)}
        onPick={(relPath) => {
          setPickerOpen(false);
          openShell(relPath);
        }}
      />
    </Box>
  );
}
