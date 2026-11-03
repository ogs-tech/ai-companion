import type { ReactNode } from 'react';
import {
  Box,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { ArrowDown, ArrowUp, LayoutGrid, Search, Table } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import type { SortState, ViewMode } from './types.js';

interface ToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string | undefined;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  toolbarActions?: ReactNode | undefined;
  entityName: string;
  /** Fields the user can sort by; the sort control is shown only in card view, where there are no headers. */
  sortFields?: { key: string; label: string }[] | undefined;
  sort?: SortState | null | undefined;
  onSortSet?: ((sort: SortState) => void) | undefined;
}

export function Toolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  view,
  onViewChange,
  toolbarActions,
  entityName,
  sortFields = [],
  sort,
  onSortSet,
}: ToolbarProps): React.ReactElement {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      sx={{ mb: 1.5, alignItems: { sm: 'center' } }}
    >
      <TextField
        size="small"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder ?? 'Buscar…'}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Icon glyph={Search} size={16} />
              </InputAdornment>
            ),
          },
          htmlInput: {
            'data-testid': `entity-grid-search-${entityName}`,
            'aria-label': `Search ${entityName}`,
          },
        }}
        sx={{ flex: 1, minWidth: 220 }}
      />
      {view === 'card' && sortFields.length > 0 && onSortSet && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label="Ordenar por"
            value={sort?.key ?? ''}
            onChange={(e) => onSortSet({ key: e.target.value, direction: sort?.direction ?? 'asc' })}
            slotProps={{ htmlInput: { 'data-testid': `entity-grid-sort-${entityName}` } }}
            sx={{ minWidth: 140 }}
          >
            {sortFields.map((f) => (
              <MenuItem key={f.key} value={f.key}>
                {f.label}
              </MenuItem>
            ))}
          </TextField>
          <IconButton
            size="small"
            disabled={!sort}
            aria-label={sort?.direction === 'desc' ? 'Ordem decrescente' : 'Ordem crescente'}
            data-testid={`entity-grid-sort-direction-${entityName}`}
            onClick={() => {
              if (sort) onSortSet({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
            }}
          >
            <Icon glyph={sort?.direction === 'desc' ? ArrowDown : ArrowUp} size={16} />
          </IconButton>
        </Stack>
      )}
      <ToggleButtonGroup
        size="small"
        exclusive
        value={view}
        onChange={(_, v: ViewMode | null) => {
          if (v) onViewChange(v);
        }}
        aria-label="View mode"
      >
        <ToggleButton
          value="card"
          data-testid={`entity-grid-view-card-${entityName}`}
          aria-label="Card view"
        >
          <Icon glyph={LayoutGrid} size={16} />
        </ToggleButton>
        <ToggleButton
          value="table"
          data-testid={`entity-grid-view-table-${entityName}`}
          aria-label="Table view"
        >
          <Icon glyph={Table} size={16} />
        </ToggleButton>
      </ToggleButtonGroup>
      {toolbarActions && <Box sx={{ flex: 0 }}>{toolbarActions}</Box>}
    </Stack>
  );
}
