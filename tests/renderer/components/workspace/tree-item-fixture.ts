import type { TreeEntity, TreeItem, TreeOrigin } from '../../../../src/renderer/lib/customization-tree.js';
import type { ChannelId } from '../../../../src/shared/channel.js';
import type { ItemStatus } from '../../../../src/shared/customization-status.js';

/** A tree row as the model builds it, for rendering one row component on its own. */
export function treeItem(
  entity: TreeEntity,
  opts: {
    urn: string;
    name: string;
    origin?: TreeOrigin;
    identity?: string;
    /** Channels in error: shorthand for an `error` status. */
    problems?: ChannelId[];
    /** Shorthand for a `draft · desativado` status. */
    disabled?: boolean;
    status?: ItemStatus;
    folderAlias?: string;
  },
): TreeItem {
  const origin = opts.origin ?? 'local';
  const status: ItemStatus | undefined =
    opts.status ??
    (opts.disabled === true
      ? { status: 'draft', reason: 'disabled', channels: {} }
      : opts.problems !== undefined && opts.problems.length > 0
        ? { status: 'error', channels: Object.fromEntries(opts.problems.map((c) => [c, { status: 'error' }])) }
        : origin === 'detected'
          ? { status: 'draft', reason: 'detected', channels: {} }
          : undefined);
  return {
    key: `${origin}:${opts.folderAlias ?? ''}:${opts.identity ?? opts.urn}`,
    urn: opts.urn,
    name: opts.name,
    origin,
    ...(opts.folderAlias !== undefined ? { folderAlias: opts.folderAlias } : {}),
    ...(status !== undefined ? { status } : {}),
    entity,
  };
}

export const rowId = (item: TreeItem): string => `tree-row-${item.key}`;
