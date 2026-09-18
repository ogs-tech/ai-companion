import { useState } from 'react';
import { useTheme } from '@mui/material/styles';
import { Separator } from 'react-resizable-panels';

/**
 * A thin drag handle between two panels, colored `divider` at rest and
 * `secondary.main` on hover/focus/drag — matches "fio antes de sombra"
 * (hairline first, no shadow) instead of a heavier grip affordance.
 */
export function ResizeHandle(): React.ReactElement {
  const theme = useTheme();
  const [active, setActive] = useState(false);
  return (
    <Separator
      aria-label="Redimensionar painel"
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        width: 4,
        flexShrink: 0,
        cursor: 'col-resize',
        backgroundColor: active ? theme.palette.secondary.main : theme.palette.divider,
        transition: 'background-color 120ms ease',
      }}
    />
  );
}
