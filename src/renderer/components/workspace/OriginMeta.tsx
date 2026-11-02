import { Tooltip, Typography } from '@mui/material';

interface OriginMetaProps {
  /** Set for a plugin-provided item; shown as the plugin's short name. */
  pluginId?: string;
}

/**
 * The quiet, fixed-height origin tag at the end of a Control Panel row — plain
 * text instead of a pill, so it can never wrap the row or squeeze the name.
 * Renders nothing for the user's own items (an inherited Global item is named by its section header).
 */
export function OriginMeta({ pluginId }: OriginMetaProps): React.ReactElement | null {
  if (pluginId === undefined) return null;
  const label = pluginId.split('@')[0] ?? pluginId;
  return (
    <Tooltip title={`Provided by plugin '${pluginId}' (read-only)`}>
      <Typography
        component="span"
        data-testid={`origin-meta-${pluginId}`}
        className="tree-row-origin"
        noWrap
        sx={{ flexShrink: 0, maxWidth: 96, fontSize: '0.6875rem', color: 'text.disabled' }}
      >
        {label}
      </Typography>
    </Tooltip>
  );
}
