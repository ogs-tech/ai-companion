/** Case-insensitive substring match over the given fields; an empty query matches everything. */
export function matchesQuery(query: string, ...fields: ReadonlyArray<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}
