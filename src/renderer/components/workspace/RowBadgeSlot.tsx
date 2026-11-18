import { useState } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { ChannelBadgeMark, badgeSize } from '../ChannelStateMark.js';
import { SessionStateMark } from '../SessionStateMark.js';
import { channelErrorLabel } from '../ds/ChannelWarning.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useInstallEntity, useUndoInstall } from '../../hooks/use-install-entity.js';
import { useItemSessions, type ItemSession } from '../../hooks/use-sessions.js';
import { IpcCallError } from '../../lib/ipc.js';
import { openDiagnosticsFor } from '../../lib/diagnostics-focus.js';
import { channelsWith, isDisabled, type TreeItem } from '../../lib/customization-tree.js';
import { CHANNEL_IDS, CHANNELS, type ChannelId } from '../../../shared/channel.js';
import type { SessionUsage } from '../../../shared/session.js';

const TAG_SX = { flexShrink: 0, fontSize: '0.75rem', whiteSpace: 'nowrap' } as const;
const MARK_SIZE = 14;

/** Why a detected row can't be imported, or `undefined` when it can (or isn't detected). */
function unimportableReason(item: TreeItem): string | undefined {
  const { entity } = item;
  const source =
    entity.kind === 'detected'
      ? entity.value
      : (entity.kind === 'mcp' || entity.kind === 'hook') && entity.value.source.kind === 'detected'
        ? entity.value.source
        : undefined;
  if (source === undefined || source.importable === true) return undefined;
  return source.reason ?? 'Não importável';
}

/** The channels where a file the app doesn't own holds the item's destination (registry order). */
function notInstalledChannels(item: TreeItem): ChannelId[] {
  const channels = item.status?.channels ?? {};
  return CHANNEL_IDS.filter((id) => channels[id]?.reason === 'not-installed');
}

/**
 * Installing over a file the app doesn't own (moved to `_backups/`), with "Desfazer" in its toast — the first item
 * of the row menu while a file is in the way ("Instalar por cima"). `available` is false when nothing is in the way.
 */
export function useInstallOver(item: TreeItem | undefined): { available: boolean; run: () => void; pending: boolean; toast: React.ReactElement } {
  const install = useInstallEntity();
  const undo = useUndoInstall();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const channels = item === undefined ? [] : notInstalledChannels(item);
  const where = channels.map((id) => CHANNELS[id].displayName).join(', ');
  const fail = (err: unknown): void => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
  const run = (): void => {
    if (item === undefined) return;
    install.mutate(
      { urn: item.urn, channels },
      {
        onSuccess: (tokens) =>
          setToast({
            variant: 'success',
            message: `"${item.name}" instalado no ${where}`,
            ...(tokens.length > 0 ? { action: { label: 'Desfazer', onClick: () => undo.mutate(tokens, { onError: fail }) } } : {}),
          }),
        onError: fail,
      },
    );
  };
  return {
    available: item?.status?.reason === 'not-installed' && channels.length > 0,
    run,
    pending: install.isPending,
    toast: <Toast toast={toast} onDismiss={() => setToast(null)} />,
  };
}

function ErrorBadge(): React.ReactElement {
  const d = badgeSize(MARK_SIZE);
  return <Box component="span" aria-hidden sx={{ width: d, height: d, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Box component="span" sx={{ width: d * 0.7, height: d * 0.7, borderRadius: '50%', bgcolor: 'error.main' }} /></Box>;
}

function ExistsBadge(): React.ReactElement {
  const d = badgeSize(MARK_SIZE);
  return (
    <Box component="svg" aria-hidden viewBox="0 0 12 12" sx={{ width: d, height: d, color: 'text.secondary' }}>
      <path d="M6 1.6L10.4 6 6 10.4 1.6 6z" stroke="currentColor" strokeWidth="1.6" fill="none" />
    </Box>
  );
}

/** A mark whose words live in the tooltip and the accessible name; the glyph alone carries shape and colour. */
function SignalMark({ testId, label, children, onActivate }: { testId: string; label: string; children: React.ReactElement; onActivate?: () => void }): React.ReactElement {
  return (
    <Tooltip title={label}>
      <Box
        component="span"
        role={onActivate ? 'button' : 'img'}
        tabIndex={onActivate ? 0 : undefined}
        aria-label={label}
        data-testid={testId}
        {...(onActivate
          ? {
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                onActivate();
              },
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                onActivate();
              },
            }
          : {})}
        sx={(theme) => ({
          display: 'inline-flex',
          flexShrink: 0,
          mr: 0.5,
          ...(onActivate ? { cursor: 'pointer', borderRadius: `${theme.ogs.radius.xs}px`, '&:focus-visible': { outline: `1px solid ${theme.palette.error.main}` } } : {}),
        })}
      >
        {children}
      </Box>
    </Tooltip>
  );
}

function sessionsLabel(sessions: readonly ItemSession[]): string {
  const [first] = sessions;
  if (first === undefined) return '';
  const where = CHANNELS[first.harness].displayName;
  if (first.state === 'needs-input') return `Uma sessão do ${where} está perguntando`;
  return sessions.length === 1 ? `Em uso por 1 sessão do ${where}` : `Em uso por ${sessions.length} sessões`;
}

interface RowSignalProps {
  item: TreeItem;
  /** Skills, agents and MCP servers: sessions that used the item show as "em uso". */
  usage?: SessionUsage;
  /** The urn sessions started from the row are anchored on. */
  anchorUrn?: string;
  /** Sign-in is pending on this channel (an MCP server): an error there even before the status report says so. */
  authChannel?: ChannelId;
  /** Urns whose problems roll up into this row (a plugin's items); Diagnósticos shows theirs too. */
  relatedUrns?: readonly string[];
}

/**
 * The row's one signal, the most urgent of: error (sign-in included) > a session asking > a file the app doesn't own
 * in the way > in use by a session > disabled; a detected row that can't be imported says why. A signal that happens
 * in a channel is that channel's mark with a badge; one that belongs to the app is a quiet word. Installed is silent.
 * Signals only inform: the row's menu (⋯ or right-click) acts, its first item resolving the signal — except the error
 * mark, which still opens Diagnósticos.
 */
export function RowSignal({ item, usage, anchorUrn, authChannel, relatedUrns = [] }: RowSignalProps): React.ReactElement | null {
  const sessions = useItemSessions(usage, anchorUrn);
  const errors = channelsWith(item, 'error');
  const errorChannels = authChannel !== undefined && !errors.includes(authChannel) ? [authChannel, ...errors] : errors;
  const [errorChannel] = errorChannels;
  if (errorChannel !== undefined) {
    const label = authChannel === errorChannel ? `Erro no ${CHANNELS[errorChannel].displayName}: login pendente` : channelErrorLabel(errorChannels);
    return (
      <SignalMark testId="channel-warning" label={`${label}. Abrir diagnóstico`} onActivate={() => openDiagnosticsFor(item.urn, relatedUrns)}>
        <ChannelBadgeMark channel={errorChannel} size={MARK_SIZE}><ErrorBadge /></ChannelBadgeMark>
      </SignalMark>
    );
  }
  const [session] = sessions;
  const sessionMark =
    session !== undefined ? (
      <SignalMark testId="row-signal-session" label={sessionsLabel(sessions)}>
        <ChannelBadgeMark channel={session.harness} size={MARK_SIZE}>
          <SessionStateMark state={session.state} size={badgeSize(MARK_SIZE)} />
        </ChannelBadgeMark>
      </SignalMark>
    ) : null;
  if (session?.state === 'needs-input') return sessionMark;
  const [occupied] = notInstalledChannels(item);
  if (item.status?.reason === 'not-installed' && occupied !== undefined) {
    return (
      <SignalMark testId="row-tag-not-installed" label={`Já existe um arquivo do ${CHANNELS[occupied].displayName} neste lugar`}>
        <ChannelBadgeMark channel={occupied} size={MARK_SIZE}><ExistsBadge /></ChannelBadgeMark>
      </SignalMark>
    );
  }
  if (sessionMark !== null) return sessionMark;
  if (isDisabled(item)) {
    return (
      <Typography component="span" data-testid="row-tag-disabled" sx={{ ...TAG_SX, color: 'text.secondary' }}>
        Desativado
      </Typography>
    );
  }
  const reason = unimportableReason(item);
  if (reason !== undefined) {
    return (
      <Typography component="span" noWrap data-testid="row-tag-unimportable" title={reason} sx={{ ...TAG_SX, color: 'text.secondary', minWidth: 0 }}>
        {reason}
      </Typography>
    );
  }
  return null;
}

/** The row's label: the name, then the folder tag of a multi-folder workspace. */
export function RowLabel({ item, label = item.name }: { item: TreeItem; label?: string }): React.ReactElement {
  return (
    <>
      {label}
      {item.folderAlias !== undefined && (
        <Box component="span" data-testid="row-folder" sx={{ color: 'text.secondary' }}>
          {' · '}
          {item.folderAlias}
        </Box>
      )}
    </>
  );
}

/**
 * Disabled and detected rows read quieter than active ones. Global rows don't: inside a workspace they are as
 * editable as the workspace's own, and their section header already says where they live.
 */
export function rowMuted(item: TreeItem): boolean {
  return item.origin === 'detected' || isDisabled(item);
}

/**
 * Detected rows recede (primary text at lower opacity, back to full on hover/focus) so they stay readable in place;
 * disabled ones go quiet (secondary text).
 */
export function rowMutedStyle(item: TreeItem): 'quiet' | 'recede' {
  return item.origin === 'detected' ? 'recede' : 'quiet';
}

export function rowTestId(item: TreeItem): string {
  return `tree-row-${item.key}`;
}
