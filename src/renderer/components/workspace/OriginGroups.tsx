import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Package, User } from 'lucide-react';
import { TreeSubGroup } from './TreeGroup.js';
import { usePersistedFlag } from '../../lib/use-persisted-flag.js';

/** Anything with a provenance: the user's own (`workspace`) or a plugin's. */
interface HasOrigin {
  source: { kind: string; pluginId?: string };
}

/** Bucket key of the user's own items; plugins use their plugin id. */
export const MINE_KEY = 'mine';

export function originKey(item: HasOrigin): string {
  return item.source.kind === 'plugin' && item.source.pluginId !== undefined ? item.source.pluginId : MINE_KEY;
}

export function originLabel(key: string): string {
  return key === MINE_KEY ? 'Meus' : (key.split('@')[0] ?? key);
}

/** "Meus" first, then plugins alphabetically by display name. */
export function sortOriginKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    if (a === b) return 0;
    if (a === MINE_KEY) return -1;
    if (b === MINE_KEY) return 1;
    return originLabel(a).localeCompare(originLabel(b));
  });
}

/**
 * How a type list takes part in a cross-type origin view (the Control Panel's
 * flat list): a `census` instance renders nothing and only reports how many
 * rows each origin has; a `bucket` instance renders just that origin's rows,
 * ungrouped, at `depth`.
 */
export type OriginView =
  | { kind: 'census'; onBuckets: (counts: Record<string, number>) => void }
  | { kind: 'bucket'; key: string; depth: number };

export interface OriginBucket<T> {
  pluginId: string | null;
  label: string;
  items: T[];
}

/** Splits `items` into "Meus" (first) and one bucket per plugin (alphabetical); empty buckets are omitted. */
export function bucketByOrigin<T extends HasOrigin>(items: T[]): Array<OriginBucket<T>> {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const key = originKey(item);
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  return sortOriginKeys([...byKey.keys()]).map((key) => ({
    pluginId: key === MINE_KEY ? null : key,
    label: originLabel(key),
    items: byKey.get(key) ?? [],
  }));
}

function useReportBuckets<T extends HasOrigin>(items: T[], view: OriginView | undefined): void {
  const counts: Record<string, number> = {};
  for (const item of items) counts[originKey(item)] = (counts[originKey(item)] ?? 0) + 1;
  const signature = JSON.stringify(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });
  useEffect(() => {
    const current = latest.current;
    if (current?.kind === 'census') current.onBuckets(counts);
    // `signature` captures `counts`; re-reporting on identity alone would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}

interface OriginSectionProps {
  originKey: string;
  count: number;
  /** Persistence key — one per scope, section and origin. */
  storageKey: string;
  testId: string;
  /** Opens the section (an active search). */
  forceOpen: boolean;
  /** Indent level of the header row; its rows sit one level deeper. */
  depth: number;
  children: React.ReactNode;
}

/** One origin of the flat Control Panel list: "Meus" or a plugin, holding every type it provides. */
export function OriginSection({ originKey: key, count, storageKey, testId, forceOpen, depth, children }: OriginSectionProps): React.ReactElement {
  // "Meus" starts open, plugins start closed — a plugin can ship dozens of items.
  const [stored, setStored] = usePersistedFlag(storageKey, key === MINE_KEY);
  return (
    <TreeSubGroup
      testId={testId}
      glyph={key === MINE_KEY ? User : Package}
      label={originLabel(key)}
      count={count}
      depth={depth}
      expanded={forceOpen || stored}
      onToggle={() => setStored(!stored)}
    >
      {children}
    </TreeSubGroup>
  );
}

interface PersistedGroupProps {
  glyph: LucideIcon;
  label: string;
  count: number;
  /** Persistence key — one per workspace, section and group. */
  storageKey: string;
  testId: string;
  /** Opens the group (an active search). */
  forceOpen: boolean;
  depth: number;
  /** Whether the group starts open when the user has not toggled it yet. */
  defaultOpen: boolean;
  /** Dims the header — a level with nothing in it. */
  muted?: boolean;
  children: React.ReactNode;
}

/** A collapsible group whose open state is remembered: a type ("Skills") or the "Plugins" block of the flat Control Panel list. */
export function PersistedGroup({ glyph, label, count, storageKey, testId, forceOpen, depth, defaultOpen, muted = false, children }: PersistedGroupProps): React.ReactElement {
  const [stored, setStored] = usePersistedFlag(storageKey, defaultOpen);
  return (
    <TreeSubGroup testId={testId} glyph={glyph} label={label} count={count} depth={depth} expanded={forceOpen || stored} onToggle={() => setStored(!stored)} muted={muted}>
      {children}
    </TreeSubGroup>
  );
}

interface OriginSubGroupProps<T> {
  glyph: LucideIcon;
  bucket: OriginBucket<T>;
  storageKey: string;
  forceOpen: boolean;
  depth: number;
  testId: string;
  children: React.ReactNode;
}

function OriginSubGroup<T>({ glyph, bucket, storageKey, forceOpen, depth, testId, children }: OriginSubGroupProps<T>): React.ReactElement {
  const [stored, setStored] = usePersistedFlag(storageKey, bucket.pluginId === null);
  return (
    <TreeSubGroup
      testId={testId}
      glyph={glyph}
      label={bucket.label}
      count={bucket.items.length}
      depth={depth}
      expanded={forceOpen || stored}
      onToggle={() => setStored(!stored)}
    >
      {children}
    </TreeSubGroup>
  );
}

interface OriginGroupsProps<T> {
  glyph: LucideIcon;
  items: T[];
  /** Persistence key prefix — one per list and workspace, e.g. `home:hook`. */
  storageScope: string;
  /** Sub-group test id prefix, e.g. `hook` → `tree-subgroup-hook-<plugin|mine>`. */
  testId: string;
  /** Opens every group (an active search). */
  forceOpen: boolean;
  /** Depth of the sub-group headers; rows sit one level deeper. */
  depth: number;
  /** Depth of the rows when nothing is grouped. Defaults to `depth`. */
  plainDepth?: number;
  /** Set when the list is one slice of a cross-type origin view; see `OriginView`. */
  view?: OriginView;
  renderRow: (item: T, depth: number) => React.ReactNode;
}

/**
 * Renders `items` grouped by origin as collapsible sub-groups. When no item
 * comes from a plugin there is nothing to group, so it stays a plain list.
 * With a `view`, the parent owns the grouping and this renders only its slice.
 */
export function OriginGroups<T extends HasOrigin>({ glyph, items, storageScope, testId, forceOpen, depth, plainDepth = depth, view, renderRow }: OriginGroupsProps<T>): React.ReactElement {
  useReportBuckets(items, view);
  if (view?.kind === 'census') return <></>;
  if (view?.kind === 'bucket') return <>{items.filter((item) => originKey(item) === view.key).map((item) => renderRow(item, view.depth))}</>;
  const buckets = bucketByOrigin(items);
  if (!buckets.some((b) => b.pluginId !== null)) return <>{items.map((item) => renderRow(item, plainDepth))}</>;
  return (
    <>
      {buckets.map((bucket) => (
        <OriginSubGroup
          glyph={glyph}
          key={bucket.pluginId ?? MINE_KEY}
          bucket={bucket}
          storageKey={`tree-subgroup:${storageScope}:${bucket.pluginId ?? MINE_KEY}`}
          forceOpen={forceOpen}
          depth={depth}
          testId={`${testId}-${bucket.pluginId ?? MINE_KEY}`}
        >
          {bucket.items.map((item) => renderRow(item, depth + 1))}
        </OriginSubGroup>
      ))}
    </>
  );
}
