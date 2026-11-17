import { Box, Stack, alpha } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { CHANNEL_IDS, CHANNELS, channelSupports, type ChannelId } from '../../../shared/channel.js';
import type { TreeFilter, TreeTotals } from '../../lib/customization-tree.js';

type AttentionFilter = Extract<TreeFilter, 'error' | 'draft'>;

/** The states worth a filter: installed is the silent default, so only what needs attention gets a chip. */
const CHIPS: ReadonlyArray<{ filter: AttentionFilter; label: (n: number) => string }> = [
  { filter: 'error', label: (n) => `${n} com erro` },
  { filter: 'draft', label: (n) => (n === 1 ? '1 rascunho' : `${n} rascunhos`) },
];

/** Channels that receive customizations — the only ones an item can be draft or in error on. */
const MANAGE_CHANNELS = CHANNEL_IDS.filter((id) => channelSupports(id, 'manage'));

interface TreeFilterChipsProps {
  value: TreeFilter;
  /** The channel sub-filter, offered while a chip is on. */
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
  disabled = false,
  tone = 'neutral',
  marker,
  onClick,
}: {
  testId: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  tone?: 'neutral' | 'error';
  /** Filled dot (error) or ring (draft) before the label. */
  marker?: 'dot' | 'ring';
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
      sx={(theme: Theme) => {
        const color = tone === 'error' ? theme.palette.error.main : theme.palette.text.secondary;
        return {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          font: 'inherit',
          fontSize: '0.75rem',
          height: 24,
          px: 1,
          borderRadius: 999,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          color: selected ? theme.palette.text.primary : color,
          border: `1px solid ${selected ? theme.palette.text.primary : tone === 'error' ? alpha(color, 0.35) : theme.palette.divider}`,
          bgcolor: selected ? theme.ogs.surfaces.rail : tone === 'error' ? alpha(color, 0.06) : 'transparent',
          '&:hover:not(:disabled)': { borderColor: selected ? theme.palette.text.primary : color },
          '&:disabled': { opacity: 0.45, cursor: 'default' },
          '&:focus-visible': { outline: `2px solid ${theme.palette.secondary.main}`, outlineOffset: 1 },
          '& .chip-marker': {
            width: 6,
            height: 6,
            borderRadius: '50%',
            boxSizing: 'border-box',
            flexShrink: 0,
            ...(marker === 'dot' ? { bgcolor: color } : { border: `1.5px solid ${color}` }),
          },
        };
      }}
    >
      {marker && <span className="chip-marker" aria-hidden />}
      {label}
    </Box>
  );
}

/**
 * What needs attention, as toggles: `N com erro`, `N rascunhos` — each shown only while it has items (or is on).
 * With one on, a second row narrows it to one channel. Nothing to report renders nothing.
 */
export function TreeFilterChips({ value, channel, totals, onChange, onChannelChange }: TreeFilterChipsProps): React.ReactElement | null {
  const shown = CHIPS.filter(({ filter }) => totals[filter] > 0 || value === filter);
  if (shown.length === 0) return null;
  const perChannel = value === 'draft' || value === 'error' ? totals.byChannel[value] : undefined;
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" role="group" aria-label="Filtrar por estado" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {shown.map(({ filter, label }) => {
          const selected = value === filter;
          return (
            <Chip
              key={filter}
              testId={`chip-${filter}`}
              label={label(totals[filter])}
              selected={selected}
              tone={filter === 'error' ? 'error' : 'neutral'}
              marker={filter === 'error' ? 'dot' : 'ring'}
              onClick={() => onChange(selected ? 'all' : filter)}
            />
          );
        })}
      </Stack>
      {perChannel !== undefined && (
        <Stack direction="row" role="group" aria-label="Filtrar por canal" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <Chip testId="chip-channel-all" label="Todos os canais" selected={channel === undefined} onClick={() => onChannelChange(undefined)} />
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
