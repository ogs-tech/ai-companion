import { useState } from 'react';
import { Box, Typography, type Theme } from '@mui/material';
import { ChannelWarning } from '../ds/ChannelWarning.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useInstallEntity, useUndoInstall } from '../../hooks/use-install-entity.js';
import { IpcCallError } from '../../lib/ipc.js';
import { channelsWith, isDisabled, rowBadge, type TreeItem } from '../../lib/customization-tree.js';
import { CHANNEL_IDS, CHANNELS, type ChannelId } from '../../../shared/channel.js';

const TAG_SX = { flexShrink: 0, fontSize: '0.6875rem', whiteSpace: 'nowrap' } as const;

/** Whether a detected row can be imported (a detected MCP/hook carries it in `source`). */
function importable(item: TreeItem): boolean {
  const { entity } = item;
  if (entity.kind === 'detected') return entity.value.importable;
  if (entity.kind === 'mcp' && entity.value.source.kind === 'detected') return entity.value.source.importable === true;
  if (entity.kind === 'hook' && entity.value.source.kind === 'detected') return entity.value.source.importable;
  return false;
}

interface RowBadgeSlotProps {
  item: TreeItem;
  /** Imports a detected row; the `detectado · importar` tag is its button. */
  onImport?: () => void;
  busy?: boolean;
}

/** The channels where a file the app doesn't own holds the item's destination (registry order). */
function notInstalledChannels(item: TreeItem): ChannelId[] {
  const channels = item.status?.channels ?? {};
  return CHANNEL_IDS.filter((id) => channels[id]?.reason === 'not-installed');
}

/** The clickable tag's look: quiet text that reads as a link (info), like `draft · importar`. */
const actionTagSx = (theme: Theme) => ({
  ...TAG_SX,
  font: 'inherit',
  fontSize: '0.6875rem',
  color: theme.palette.info.main,
  background: 'none',
  border: 0,
  borderRadius: `${theme.ogs.radius.xs}px`,
  px: 0.5,
  cursor: 'pointer',
  '&:hover': { bgcolor: `${theme.palette.info.main}24` },
  '&:disabled': { opacity: 0.5, cursor: 'default' },
});

/**
 * `draft · instalar`: a file the app doesn't own sits where the item goes. Clicking installs over it (the file/folder
 * is moved to `_backups/`) and the toast's Desfazer moves it back.
 */
function InstallTag({ item, channels }: { item: TreeItem; channels: ChannelId[] }): React.ReactElement {
  const install = useInstallEntity();
  const undo = useUndoInstall();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const where = channels.map((id) => CHANNELS[id].displayName).join(', ');
  const fail = (err: unknown): void => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });

  const runInstall = (): void =>
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

  return (
    <>
      <Box
        component="button"
        type="button"
        disabled={install.isPending}
        data-testid="row-tag-not-installed"
        aria-label={`Instalar ${item.name} no ${where}`}
        title={`Já existe um arquivo do ${where} neste lugar. Instalar faz backup dele e passa o controle para o app.`}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          runInstall();
        }}
        sx={actionTagSx}
      >
        draft · instalar
      </Box>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

/**
 * The row's single trailing tag, from its status: `⚠ <canais>` (error — something the app installed went wrong),
 * or `draft · <why>` — `importar` (detected), `instalar` (a file the app doesn't own is there), `desativado`.
 * Installed is silent.
 */
export function RowBadgeSlot({ item, onImport, busy = false }: RowBadgeSlotProps): React.ReactElement | null {
  const badge = rowBadge(item);
  if (badge === null) return null;
  if (badge === 'error') return <ChannelWarning urn={item.urn} channels={channelsWith(item, 'error')} />;
  if (item.status?.reason === 'not-installed') return <InstallTag item={item} channels={notInstalledChannels(item)} />;
  if (item.status?.reason === 'disabled') {
    return (
      <Typography component="span" data-testid="row-tag-disabled" sx={{ ...TAG_SX, color: 'text.disabled' }}>
        draft · desativado
      </Typography>
    );
  }
  if (!importable(item) || onImport === undefined) {
    return (
      <Typography component="span" data-testid="row-tag-detected" sx={{ ...TAG_SX, color: 'text.disabled' }}>
        {importable(item) ? 'draft' : 'draft · não importável'}
      </Typography>
    );
  }
  return (
    <Box
      component="button"
      type="button"
      disabled={busy}
      data-testid="row-tag-detected"
      aria-label={`Importar ${item.name}`}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onImport();
      }}
      sx={actionTagSx}
    >
      draft · importar
    </Box>
  );
}

/** The row's label: the name, then the folder tag of a multi-folder workspace. */
export function RowLabel({ item, label = item.name }: { item: TreeItem; label?: string }): React.ReactElement {
  return (
    <>
      {label}
      {item.folderAlias !== undefined && (
        <Box component="span" data-testid="row-folder" sx={{ color: 'text.disabled' }}>
          {' · '}
          {item.folderAlias}
        </Box>
      )}
    </>
  );
}

/** Global, disabled and detected rows read quieter than the scope's own active items. */
export function rowMuted(item: TreeItem): boolean {
  return item.origin !== 'local' || isDisabled(item);
}

export function rowTestId(item: TreeItem): string {
  return `tree-row-${item.key}`;
}
