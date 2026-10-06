import { Box, Tooltip } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../../ds/Icon.js';

interface RowActionProps {
  glyph: LucideIcon;
  label: string;
  testId: string;
  onAction: () => void;
  disabled?: boolean;
}

/**
 * A tree row's hover action — the same keyboard-reachable `span[role=button]`
 * idiom the other tree groups use, stopping propagation so the row's own
 * click (open the diff) doesn't fire too.
 */
export function RowAction({
  glyph,
  label,
  testId,
  onAction,
  disabled = false,
}: RowActionProps): React.ReactElement {
  const fire = (e: React.SyntheticEvent): void => {
    e.stopPropagation();
    if (!disabled) onAction();
  };
  return (
    <Tooltip title={label}>
      <Box
        component="span"
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-disabled={disabled}
        data-testid={testId}
        onClick={fire}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          if (e.key === ' ') e.preventDefault();
          fire(e);
        }}
        sx={{
          display: 'inline-flex',
          p: 0.5,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Icon glyph={glyph} size={13} />
      </Box>
    </Tooltip>
  );
}
