import { useMemo, useState } from 'react';
import {
  Box,
  MenuItem,
  Pagination,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { CardView } from './CardView.js';
import { TableView } from './TableView.js';
import { Toolbar } from './Toolbar.js';
import type { EntityDataGridProps, SortState, ViewMode } from './types.js';
import { filterBySearch, paginate, sortItems, viewStorageKey } from './utils.js';
import { LoadingState } from '../ds/LoadingState.js';
import { ErrorState } from '../ds/ErrorState.js';

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100] as const;

function resolveInitialView(entityName: string, defaultView: ViewMode): ViewMode {
  const stored = localStorage.getItem(viewStorageKey(entityName));
  if (stored === 'card' || stored === 'table') return stored;
  return defaultView;
}

export function EntityDataGrid<T>({
  entity,
  data,
  isLoading,
  error,
  actions,
  toolbarActions,
  cardSlots,
  pageSize = 5,
  searchPlaceholder,
  emptyState,
  onRowClick,
  isDimmed,
}: EntityDataGridProps<T>): React.ReactElement {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(entity.defaultSort ?? null);
  const [currentPageSize, setCurrentPageSize] = useState(pageSize);
  const [view, setView] = useState<ViewMode>(() =>
    resolveInitialView(entity.name, entity.defaultView ?? 'card'),
  );

  const handleSearchChange = (value: string): void => {
    setSearch(value);
    setPage(1);
  };

  const handlePageSizeChange = (value: number): void => {
    setCurrentPageSize(value);
    setPage(1);
  };

  // First click on a column sorts ascending, the next flips it.
  const handleSortChange = (key: string): void => {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
    setPage(1);
  };

  const handleSortSet = (next: SortState): void => {
    setSort(next);
    setPage(1);
  };

  const handleViewChange = (v: ViewMode): void => {
    setView(v);
    localStorage.setItem(viewStorageKey(entity.name), v);
  };

  const items = useMemo(() => data ?? [], [data]);
  const filtered = useMemo(
    () => filterBySearch(items, entity.fields, search),
    [items, entity.fields, search],
  );
  const sorted = useMemo(
    () => sortItems(filtered, entity.fields, sort),
    [filtered, entity.fields, sort],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / currentPageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => paginate(sorted, safePage, currentPageSize),
    [sorted, safePage, currentPageSize],
  );

  const pageSizeOptions = useMemo<readonly number[]>(() => {
    if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(currentPageSize)) {
      return PAGE_SIZE_OPTIONS;
    }
    return [currentPageSize, ...PAGE_SIZE_OPTIONS].sort((a, b) => a - b);
  }, [currentPageSize]);

  const showFooter =
    filtered.length > Math.min(currentPageSize, ...PAGE_SIZE_OPTIONS);

  const errorMessage =
    error !== undefined && error !== null
      ? error instanceof Error
        ? error.message
        : String(error)
      : null;

  return (
    <Box data-testid={`entity-grid-${entity.name}`}>
      <Toolbar
        entityName={entity.name}
        search={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={searchPlaceholder}
        view={view}
        onViewChange={handleViewChange}
        toolbarActions={toolbarActions}
        sortFields={entity.fields.filter((f) => f.sortable).map(({ key, label }) => ({ key, label }))}
        sort={sort}
        onSortSet={handleSortSet}
      />

      {errorMessage !== null && (
        <ErrorState message={errorMessage} testId={entity.name} />
      )}

      {isLoading && items.length === 0 ? (
        <LoadingState kind="list" testId={entity.name} />
      ) : filtered.length === 0 ? (
        <EmptyBlock
          isFiltered={search.length > 0}
          fallback={emptyState}
          entityPlural={entity.pluralName ?? `${entity.name}s`}
        />
      ) : view === 'table' ? (
        <TableView
          entity={entity}
          items={paged}
          actions={actions}
          onRowClick={onRowClick}
          isDimmed={isDimmed}
          sort={sort}
          onSortChange={handleSortChange}
        />
      ) : (
        <CardView
          entity={entity}
          items={paged}
          actions={actions}
          cardSlots={cardSlots}
          onRowClick={onRowClick}
          isDimmed={isDimmed}
        />
      )}

      {showFooter && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{
            mt: 2,
            alignItems: { sm: 'center' },
            justifyContent: 'space-between',
          }}
          data-testid={`entity-grid-pagination-${entity.name}`}
        >
          <TextField
            select
            size="small"
            label="Por página"
            value={currentPageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            slotProps={{
              htmlInput: {
                'data-testid': `entity-grid-page-size-${entity.name}`,
                'aria-label': `Items per page for ${entity.name}`,
              },
            }}
            sx={{ minWidth: 110 }}
          >
            {pageSizeOptions.map((size) => (
              <MenuItem key={size} value={size}>
                {size}
              </MenuItem>
            ))}
          </TextField>
          {totalPages > 1 ? (
            <Pagination
              count={totalPages}
              page={safePage}
              onChange={(_, p) => setPage(p)}
              color="primary"
              size="small"
              showFirstButton
              showLastButton
            />
          ) : (
            <Box />
          )}
          <Typography variant="caption" color="text.secondary">
            {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
          </Typography>
        </Stack>
      )}
    </Box>
  );
}

interface EmptyBlockProps {
  isFiltered: boolean;
  entityPlural: string;
  fallback?: React.ReactNode;
}

function EmptyBlock({
  isFiltered,
  entityPlural: _entityPlural,
  fallback,
}: EmptyBlockProps): React.ReactElement {
  if (isFiltered) {
    return (
      <Box
        sx={{
          border: 1,
          borderStyle: 'dashed',
          borderColor: 'divider',
          borderRadius: 1,
          p: 2.5,
          textAlign: 'center',
          color: 'text.secondary',
        }}
      >
        <Typography variant="body2">
          Nenhum resultado para a busca.
        </Typography>
      </Box>
    );
  }
  if (fallback) return <>{fallback}</>;
  return (
    <Box
      sx={{
        border: 1,
        borderStyle: 'dashed',
        borderColor: 'divider',
        borderRadius: 1,
        p: 4,
        textAlign: 'center',
        color: 'text.secondary',
      }}
    >
      <Typography variant="body2">Nada por aqui ainda.</Typography>
    </Box>
  );
}
