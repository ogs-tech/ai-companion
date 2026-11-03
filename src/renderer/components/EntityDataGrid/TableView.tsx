import {
  Box,
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
} from '@mui/material';
import type { EntityDef, FieldDef, RowAction, SortState } from './types.js';
import { renderFieldValue } from './utils.js';

interface TableViewProps<T> {
  entity: EntityDef<T>;
  items: T[];
  actions?: RowAction<T>[] | undefined;
  onRowClick?: ((item: T) => void) | undefined;
  isDimmed?: ((item: T) => boolean) | undefined;
  sort?: SortState | null | undefined;
  onSortChange?: ((key: string) => void) | undefined;
}

export function TableView<T>({
  entity,
  items,
  actions,
  onRowClick,
  isDimmed,
  sort,
  onSortChange,
}: TableViewProps<T>): React.ReactElement {
  const columns = entity.fields.filter((f) => !f.hideInTable);
  const hasActions = !!actions && actions.length > 0;

  return (
    <TableContainer
      component={Box}
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        maxHeight: 'calc(100vh - 260px)',
        overflowY: 'auto',
      }}
    >
      <Table
        size="small"
        stickyHeader
        data-testid={`entity-grid-table-${entity.name}`}
      >
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell
                key={col.key}
                align={col.align ?? 'left'}
                sortDirection={sort?.key === col.key ? sort.direction : false}
                sx={{
                  width: col.width,
                  fontWeight: 600,
                  bgcolor: 'background.default',
                  whiteSpace: 'nowrap',
                }}
              >
                {col.sortable && onSortChange ? (
                  <TableSortLabel
                    active={sort?.key === col.key}
                    direction={sort?.key === col.key ? sort.direction : 'asc'}
                    onClick={() => onSortChange(col.key)}
                    data-testid={`sort-${col.key}`}
                  >
                    {col.label}
                  </TableSortLabel>
                ) : (
                  col.label
                )}
              </TableCell>
            ))}
            {hasActions && (
              <TableCell
                align="right"
                sx={{
                  width: 1,
                  fontWeight: 600,
                  bgcolor: 'background.default',
                  whiteSpace: 'nowrap',
                }}
              >
                Actions
              </TableCell>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={entity.getKey(item)}
              hover
              sx={{
                cursor: onRowClick ? 'pointer' : 'default',
                opacity: isDimmed?.(item) ? 0.55 : 1,
              }}
              onClick={onRowClick ? () => onRowClick(item) : undefined}
              data-testid={`entity-grid-row-${entity.name}-${entity.getKey(item)}`}
            >
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  align={col.align ?? 'left'}
                  sx={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: col.width ?? 360,
                  }}
                >
                  {renderCell(col, item)}
                </TableCell>
              ))}
              {hasActions && (
                <TableCell
                  align="right"
                  onClick={(e) => e.stopPropagation()}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ justifyContent: 'flex-end' }}
                  >
                    {actions
                      .filter((a) => !a.hidden?.(item))
                      .map((action) => (
                        <Tooltip key={action.label} title={action.label}>
                          <span>
                            <IconButton
                              size="small"
                              color={
                                action.variant === 'destructive'
                                  ? 'error'
                                  : 'default'
                              }
                              disabled={action.disabled?.(item)}
                              onClick={(e) => {
                                e.stopPropagation();
                                action.onClick(item);
                              }}
                              aria-label={action.label}
                            >
                              {action.icon}
                            </IconButton>
                          </span>
                        </Tooltip>
                      ))}
                  </Stack>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function renderCell<T>(field: FieldDef<T>, item: T): React.ReactNode {
  const value = renderFieldValue(field, item, 'table');
  if (value === null || value === undefined || value === '') return '—';
  if (field.badge) {
    return <Chip size="small" variant="outlined" label={value as React.ReactNode} />;
  }
  if (field.primary) {
    return <Box component="strong">{value as React.ReactNode}</Box>;
  }
  return value as React.ReactNode;
}
