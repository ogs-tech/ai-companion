import type { FieldDef, SortState, ViewMode } from './types.js';

export function getFieldValue<T>(item: T, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    if (typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, item);
}

export function renderFieldValue<T>(
  field: FieldDef<T>,
  item: T,
  view: ViewMode,
): unknown {
  if (field.render) return field.render(item, view);
  return getFieldValue(item, field.key);
}

export function filterBySearch<T>(
  items: T[],
  fields: FieldDef<T>[],
  query: string,
): T[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return items;
  const searchable = fields.filter((f) => f.searchable);
  if (searchable.length === 0) return items;
  return items.filter((item) =>
    searchable.some((field) => {
      const value = getFieldValue(item, field.key);
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(trimmed);
    }),
  );
}

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function viewStorageKey(entityName: string): string {
  return `entity-grid:${entityName}:view`;
}

function sortKeyOf<T>(field: FieldDef<T>, item: T): string | number | null {
  if (field.sortValue) return field.sortValue(item);
  const value = getFieldValue(item, field.key);
  if (typeof value === 'number' || typeof value === 'string') return value;
  return null;
}

/** Stable sort by a field; missing values (`null`) stay last in both directions. */
export function sortItems<T>(items: T[], fields: FieldDef<T>[], sort: SortState | null): T[] {
  const field = sort ? fields.find((f) => f.key === sort.key && f.sortable) : undefined;
  if (!sort || !field) return items;
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const left = sortKeyOf(field, a);
    const right = sortKeyOf(field, b);
    if (left === null || right === null) {
      return left === right ? 0 : left === null ? 1 : -1;
    }
    if (typeof left === 'number' && typeof right === 'number') return sign * (left - right);
    return sign * String(left).localeCompare(String(right));
  });
}
