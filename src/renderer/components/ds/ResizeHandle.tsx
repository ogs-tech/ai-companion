import { useState } from 'react';
import { useTheme } from '@mui/material/styles';
import { Separator } from 'react-resizable-panels';

/**
 * The 6px gap between two panel cards, doubling as their drag handle:
 * transparent at rest (the cards' own borders are the hairlines), a 2px
 * `secondary.main` line centered in the gap on hover/focus/drag.
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
        width: 6,
        flexShrink: 0,
        cursor: 'col-resize',
        backgroundColor: 'transparent',
        backgroundImage: `linear-gradient(${theme.palette.secondary.main}, ${theme.palette.secondary.main})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        backgroundSize: active ? '2px 100%' : '0 100%',
        transition: 'background-size 120ms ease',
        outline: 'none',
      }}
    />
  );
}
