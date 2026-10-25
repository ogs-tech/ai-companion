import { useState } from 'react';
import { useTheme } from '@mui/material/styles';
import { Separator } from 'react-resizable-panels';

/**
 * The 6px gap between two panel cards, doubling as their drag handle:
 * transparent at rest (the cards' own borders are the hairlines), a 2px
 * `secondary.main` line centered in the gap on hover/focus/drag. `vertical`
 * is the same handle for a stacked pair (a horizontal bar between two rows).
 */
export function ResizeHandle({ orientation = 'horizontal' }: { orientation?: 'horizontal' | 'vertical' } = {}): React.ReactElement {
  const stacked = orientation === 'vertical';
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
        ...(stacked
          ? {
              // A canvas-colored band with hairlines: it reads as the gap between two containers inside one card.
              height: 12,
              borderTop: `1px solid ${theme.palette.divider}`,
              borderBottom: `1px solid ${theme.palette.divider}`,
            }
          : { width: 6 }),
        flexShrink: 0,
        cursor: stacked ? 'row-resize' : 'col-resize',
        backgroundColor: stacked ? theme.ogs.surfaces.canvas : 'transparent',
        backgroundImage: `linear-gradient(${theme.palette.secondary.main}, ${theme.palette.secondary.main})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        backgroundSize: active ? (stacked ? '100% 2px' : '2px 100%') : (stacked ? '100% 0' : '0 100%'),
        transition: 'background-size 120ms ease',
        outline: 'none',
        ...(stacked ? { display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}),
      }}
    >
      {/* A stacked pair has no card borders to hint at the handle, so it keeps a visible grip at rest. */}
      {stacked && <span aria-hidden style={{ width: 28, height: 3, borderRadius: 2, backgroundColor: theme.palette.divider }} />}
    </Separator>
  );
}
