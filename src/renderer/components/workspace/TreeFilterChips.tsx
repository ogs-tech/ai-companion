import { Box, Stack } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { CHANNEL_IDS, CHANNELS, channelSupports, type ChannelId } from '../../../shared/channel.js';
import type { TreeFilter, TreeTotals } from '../../lib/customization-tree.js';

const CHIPS: ReadonlyArray<{ filter: TreeFilter; label: string; count: (totals: TreeTotals) => number }> = [
  { filter: 'all', label: 'Todos', count: (t) => t.all },
  { filter: 'installed', label: 'Instalado', count: (t) => t.installed },
  { filter: 'draft', label: 'Draft', count: (t) => t.draft },
  { filter: 'error', label: 'Com erro', count: (t) => t.error },
];

/** Channels that receive customizations — the only ones an item can be draft or in error on. */
const MANAGE_CHANNELS = CHANNEL_IDS.filter((id) => channelSupports(id, 'manage'));

interface TreeFilterChipsProps {
  value: TreeFilter;
  /** The channel sub-filter, offered while Draft or Com erro is on. */
  channel: ChannelId | undefined;
  /** Counts on the search-filtered set, so a chip's number is what selecting it shows. */
  totals: TreeTotals;
  onChange: (filter: TreeFilter) => void;
  onChannelChange: (channel: ChannelId | undefined) => void;
}

function Chip({
  testId,
  label,
  selected,
  disabled,
  warn = false,
  onClick,
}: {
  testId: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  warn?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Box
      component="button"
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      sx={(theme: Theme) => ({
        font: 'inherit',
        fontSize: '0.6875rem',
        lineHeight: 1.6,
        px: 0.75,
        borderRadius: 999,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        border: `1px solid ${selected ? theme.palette.primary.main : theme.palette.divider}`,
        color: selected ? theme.palette.primary.main : warn ? theme.palette.warning.main : theme.palette.text.secondary,
        bgcolor: selected ? `${theme.palette.primary.main}1f` : 'transparent',
        '&:hover:not(:disabled)': { borderColor: theme.palette.text.secondary },
        '&:disabled': { opacity: 0.45, cursor: 'default' },
        '&:focus-visible': { outline: `1px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
      })}
    >
      {label}
    </Box>
  );
}

/**
 * Single-select status filters over the tree; with Draft or Com erro on, a second row narrows it to one channel.
 * A chip at 0 stays in place, disabled; a selected one that a search empties stays pressed, and "Limpar filtros"
 * brings the list back.
 */
export function TreeFilterChips({ value, channel, totals, onChange, onChannelChange }: TreeFilterChipsProps): React.ReactElement {
  const perChannel = value === 'draft' || value === 'error' ? totals.byChannel[value] : undefined;
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" role="group" aria-label="Filtrar por estado" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {CHIPS.map(({ filter, label, count }) => {
          const selected = value === filter;
          const n = count(totals);
          return (
            <Chip
              key={filter}
              testId={`chip-${filter}`}
              label={filter === 'all' ? label : `${label} ${n}`}
              selected={selected}
              disabled={filter !== 'all' && n === 0}
              warn={filter === 'error' && n > 0}
              onClick={() => onChange(selected && filter !== 'all' ? 'all' : filter)}
            />
          );
        })}
      </Stack>
      {perChannel !== undefined && (
        <Stack direction="row" role="group" aria-label="Filtrar por canal" sx={{ flexWrap: 'wrap', gap: 0.5, pl: 1 }}>
          <Chip testId="chip-channel-all" label="Todos" selected={channel === undefined} disabled={false} onClick={() => onChannelChange(undefined)} />
          {MANAGE_CHANNELS.map((id) => {
            const n = perChannel[id] ?? 0;
            const selected = channel === id;
            return (
              <Chip
                key={id}
                testId={`chip-channel-${id}`}
                label={`${CHANNELS[id].displayName} ${n}`}
                selected={selected}
                disabled={n === 0 && !selected}
                onClick={() => onChannelChange(selected ? undefined : id)}
              />
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
