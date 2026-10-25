import { Tooltip, Typography } from '@mui/material';

interface OriginMetaProps {
  /** Set for a plugin-provided item; shown as the plugin's short name. */
  pluginId?: string;
  /** An item that belongs to Global but is listed inside a workspace. */
  inherited?: boolean;
}

/**
 * The quiet, fixed-height origin tag at the end of a Control Panel row — plain
 * text instead of a pill, so it can never wrap the row or squeeze the name.
 * Renders nothing for the user's own, in-scope items.
 */
export function OriginMeta({ pluginId, inherited = false }: OriginMetaProps): React.ReactElement | null {
  const label = pluginId !== undefined ? (pluginId.split('@')[0] ?? pluginId) : inherited ? 'global' : undefined;
  if (label === undefined) return null;
  return (
    <Tooltip title={pluginId !== undefined ? `Provided by plugin '${pluginId}' (read-only)` : 'Global (read-only here)'}>
      <Typography
        component="span"
        data-testid={pluginId !== undefined ? `origin-meta-${pluginId}` : 'origin-meta-global'}
        className="tree-row-origin"
        noWrap
        sx={{ flexShrink: 0, maxWidth: 96, fontSize: '0.6875rem', color: 'text.disabled' }}
      >
        {label}
      </Typography>
    </Tooltip>
  );
}
