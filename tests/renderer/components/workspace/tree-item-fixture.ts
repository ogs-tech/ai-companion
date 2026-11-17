import type { TreeEntity, TreeItem, TreeOrigin } from '../../../../src/renderer/lib/customization-tree.js';
import type { ChannelId } from '../../../../src/shared/channel.js';

/** A tree row as the model builds it, for rendering one row component on its own. */
export function treeItem(
  entity: TreeEntity,
  opts: { urn: string; name: string; origin?: TreeOrigin; identity?: string; problems?: ChannelId[]; disabled?: boolean; folderAlias?: string },
): TreeItem {
  const origin = opts.origin ?? 'local';
  return {
    key: `${origin}:${opts.folderAlias ?? ''}:${opts.identity ?? opts.urn}`,
    urn: opts.urn,
    name: opts.name,
    origin,
    ...(opts.folderAlias !== undefined ? { folderAlias: opts.folderAlias } : {}),
    state: { problems: opts.problems ?? [], disabled: opts.disabled ?? false },
    entity,
  };
}

export const rowId = (item: TreeItem): string => `tree-row-${item.key}`;
