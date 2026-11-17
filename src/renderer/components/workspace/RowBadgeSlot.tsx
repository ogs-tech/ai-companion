import { Box, Typography } from '@mui/material';
import { ChannelWarning } from '../ds/ChannelWarning.js';
import { rowBadge, type TreeItem } from '../../lib/customization-tree.js';

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

/** The row's single trailing tag, by precedence: `⚠ <canais>` > `desativado` > `detectado · importar`. Ok is silent. */
export function RowBadgeSlot({ item, onImport, busy = false }: RowBadgeSlotProps): React.ReactElement | null {
  switch (rowBadge(item)) {
    case 'problem':
      return <ChannelWarning urn={item.urn} channels={item.state.problems} />;
    case 'disabled':
      return (
        <Typography component="span" data-testid="row-tag-disabled" sx={{ ...TAG_SX, color: 'text.disabled' }}>
          desativado
        </Typography>
      );
    case 'detected':
      if (!importable(item) || onImport === undefined) {
        return (
          <Typography component="span" data-testid="row-tag-detected" sx={{ ...TAG_SX, color: 'text.disabled' }}>
            {importable(item) ? 'detectado' : 'detectado · não importável'}
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
          sx={(theme) => ({
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
          })}
        >
          detectado · importar
        </Box>
      );
    case null:
      return null;
  }
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
  return item.origin !== 'local' || item.state.disabled;
}

export function rowTestId(item: TreeItem): string {
  return `tree-row-${item.key}`;
}
