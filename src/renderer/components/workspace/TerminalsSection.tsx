import { useState } from 'react';
import { Box, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Play, Plus, RotateCw, Square, X } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { treeGroupLabelSx } from '../ds/TreeRow.js';
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
import type { TerminalSnapshot } from '../../../shared/terminal.js';

interface TerminalsSectionProps {
  /** Terminals that currently have a canvas tab; the rest are marked `sem aba`. */
  openTerminalIds: ReadonlySet<string>;
  /** Called with a terminal to show in the canvas — a new one, or an existing row clicked. */
  onOpen: (terminal: TerminalSnapshot) => void;
  /** A removed terminal can no longer have a tab. */
  onRemoved: (terminalId: string) => void;
  onEditLaunchJson: () => void;
  onError: (message: string) => void;
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
export function TerminalsSection({ openTerminalIds, onOpen, onRemoved, onEditLaunchJson, onError }: TerminalsSectionProps): React.ReactElement {
  const { data: terminals = [] } = useTerminals();
  const { data: launch } = useLaunchConfigs();
  const createTerminal = useCreateTerminal();
  const runConfig = useRunLaunchConfig();
  const killTerminal = useKillTerminal();
  const restartTerminal = useRestartTerminal();
  const removeTerminal = useRemoveTerminal();
  const [expanded, setExpanded] = useState(true);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const fail = (err: unknown): void => onError(errorMessage(err));
  const closeMenu = (): void => setMenuAnchor(null);
  const openShell = (relCwd: string): void =>
    createTerminal.mutate({ ...(relCwd !== '' ? { relCwd } : {}) }, { onSuccess: (terminal) => onOpen(terminal), onError: fail });

  return (
    <Box data-testid="terminals-section" sx={{ borderTop: 1, borderColor: 'divider', flexShrink: 0, maxHeight: '45%', display: 'flex', flexDirection: 'column' }}>
      <Box
        data-testid="terminals-header"
        onClick={() => setExpanded((v) => !v)}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 1, pr: 0.5, py: 0.25, cursor: 'pointer' }}
      >
        <Icon glyph={expanded ? ChevronDown : ChevronRight} size={14} />
        <Typography component="span" sx={{ ...treeGroupLabelSx, flex: 1 }}>Terminais</Typography>
        <Typography component="span" sx={{ fontSize: '0.6875rem', color: 'text.disabled' }}>{terminals.length}</Typography>
        <Tooltip title="Novo terminal">
          <Box
            component="span"
            role="button"
            tabIndex={0}
            aria-label="Novo terminal"
            aria-haspopup="menu"
            data-testid="terminals-new-menu"
            onClick={(e) => {
              e.stopPropagation();
              setMenuAnchor(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              setMenuAnchor(e.currentTarget);
            }}
            sx={{ display: 'inline-flex', alignItems: 'center', p: 0.5, cursor: 'pointer' }}
          >
            <Icon glyph={Plus} size={14} />
            <Icon glyph={ChevronDown} size={11} />
          </Box>
        </Tooltip>
      </Box>
      {expanded && (
        <Box sx={{ overflowY: 'auto', pb: 0.5 }}>
          {terminals.length === 0 && (
            <Typography variant="caption" color="text.secondary" data-testid="terminals-empty" sx={{ display: 'block', px: 1.5, py: 0.75 }}>
              Nenhum terminal aberto
            </Typography>
          )}
          {terminals.map((terminal) => (
            <Box
              key={terminal.terminalId}
              data-testid={`terminal-row-${terminal.terminalId}`}
              onClick={() => onOpen(terminal)}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 1.5, pr: 0.5, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
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
                {terminal.relCwd === '' ? 'raiz' : terminal.relCwd}
              </Typography>
              {terminal.kind === 'launch' && <Typography component="span" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>launch</Typography>}
              {!openTerminalIds.has(terminal.terminalId) && (
                <Typography component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>sem aba</Typography>
              )}
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
          ))}
        </Box>
      )}
      <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={closeMenu}>
        <MenuItem data-testid="terminals-menu-root" onClick={() => { closeMenu(); openShell(''); }}>Novo terminal na raiz</MenuItem>
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
                runConfig.mutate({ configName: config.name }, { onSuccess: (terminal) => onOpen(terminal), onError: fail });
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
