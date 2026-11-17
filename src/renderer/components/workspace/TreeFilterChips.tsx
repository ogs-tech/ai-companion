import { Box, Stack } from '@mui/material';
import type { TreeFilter, TreeTotals } from '../../lib/customization-tree.js';

const CHIPS: ReadonlyArray<{ filter: TreeFilter; label: (totals: TreeTotals) => string; count: (totals: TreeTotals) => number }> = [
  { filter: 'all', label: () => 'Todos', count: (t) => t.all },
  { filter: 'problems', label: (t) => `⚠ Problemas ${t.problems}`, count: (t) => t.problems },
  { filter: 'disabled', label: (t) => `Desativados ${t.disabled}`, count: (t) => t.disabled },
  { filter: 'detected', label: (t) => `Detectados ${t.detected}`, count: (t) => t.detected },
];

interface TreeFilterChipsProps {
  value: TreeFilter;
  /** Counts on the search-filtered set, so a chip's number is what selecting it shows. */
  totals: TreeTotals;
  onChange: (filter: TreeFilter) => void;
}

/**
 * Single-select state filters over the tree. A chip at 0 stays in place, disabled; a selected one that a
 * search empties stays pressed too, and "Limpar filtros" brings the list back.
 */
export function TreeFilterChips({ value, totals, onChange }: TreeFilterChipsProps): React.ReactElement {
  return (
    <Stack direction="row" role="group" aria-label="Filtrar por estado" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      {CHIPS.map(({ filter, label, count }) => {
        const selected = value === filter;
        const disabled = filter !== 'all' && count(totals) === 0;
        return (
          <Box
            key={filter}
            component="button"
            type="button"
            data-testid={`chip-${filter}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(selected && filter !== 'all' ? 'all' : filter)}
            sx={(theme) => ({
              font: 'inherit',
              fontSize: '0.6875rem',
              lineHeight: 1.6,
              px: 0.75,
              borderRadius: 999,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              border: `1px solid ${selected ? theme.palette.primary.main : theme.palette.divider}`,
              color: selected ? theme.palette.primary.main : filter === 'problems' && count(totals) > 0 ? theme.palette.warning.main : theme.palette.text.secondary,
              bgcolor: selected ? `${theme.palette.primary.main}1f` : 'transparent',
              '&:hover:not(:disabled)': { borderColor: theme.palette.text.secondary },
              '&:disabled': { opacity: 0.45, cursor: 'default' },
              '&:focus-visible': { outline: `1px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
            })}
          >
            {label(totals)}
          </Box>
        );
      })}
    </Stack>
  );
}
