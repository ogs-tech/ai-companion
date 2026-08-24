import { Box, List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import { Icon } from '../ds/Icon.js';
import { Kicker } from '../ds/Kicker.js';
import { LIBRARY_SUBS, PLUGINS_SUBS, type Nav, type SubDef } from './nav.js';

interface SubRailProps {
  nav: Nav;
  onSelect: (nav: Nav) => void;
}

export const SUBRAIL_WIDTH = 220;

export function SubRail({ nav, onSelect }: SubRailProps): React.ReactElement | null {
  if (!('sub' in nav)) return null;

  const section = nav.area === 'biblioteca' ? 'Biblioteca' : 'Plugins';
  const items: ReadonlyArray<SubDef<string>> = nav.area === 'biblioteca' ? LIBRARY_SUBS : PLUGINS_SUBS;
  const activeSub = nav.sub;

  return (
    <Box
      component="nav"
      aria-label={section}
      sx={(theme) => ({
        width: SUBRAIL_WIDTH,
        flexShrink: 0,
        borderRight: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.ogs.surfaces.rail,
        px: 1.5,
        py: 2,
      })}
    >
      <Box sx={{ px: 1, mb: 1 }}>
        <Kicker>{section}</Kicker>
      </Box>
      <List dense disablePadding>
        {items.map((item) => {
          const selected = item.sub === activeSub;
          return (
            <ListItemButton
              key={item.sub}
              data-testid={`nav-${item.sub}`}
              selected={selected}
              {...(selected ? { 'aria-current': 'page' as const } : {})}
              onClick={() => onSelect({ area: nav.area, sub: item.sub } as Nav)}
              sx={(theme) => ({
                borderRadius: theme.ogs.radius.sm,
                mb: 0.5,
                borderLeft: selected
                  ? `2px solid ${theme.palette.info.main}`
                  : '2px solid transparent',
                '&.Mui-selected': { bgcolor: 'action.selected' },
              })}
            >
              <ListItemIcon sx={{ minWidth: 30, color: selected ? 'text.primary' : 'text.secondary' }}>
                <Icon glyph={item.glyph} size={16} />
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                slotProps={{
                  primary: {
                    variant: 'body2',
                    sx: { fontWeight: selected ? 600 : 400 },
                  },
                }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
