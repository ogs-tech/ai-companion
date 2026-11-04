import { Badge, Box, Tooltip } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';

export type ExplorerView = 'files' | 'git' | 'terminals';

/** One destination on the rail — a view of the open workspace, or (at Início) an app area. */
export interface RailItem {
  /** Also the prefix of the badge/severity test ids. */
  testId: string;
  label: string;
  glyph: LucideIcon;
  active: boolean;
  onClick: () => void;
  /** Hidden at 0. */
  count?: number | undefined;
  /** The icon dims but stays clickable. */
  dimmed?: boolean | undefined;
  badgeColor?: 'warning' | 'success' | undefined;
  /** A small status dot on the icon (e.g. Diagnóstico's worst severity). */
  severity?: 'warning' | 'error' | undefined;
}

function RailButton({ testId, label, glyph, active, dimmed = false, count, badgeColor = 'warning', severity, onClick }: RailItem): React.ReactElement {
  return (
    <Tooltip title={label} placement="right">
      {/* The span keeps the tooltip working over a disabled button. */}
      <span>
        <Box
          component="button"
          type="button"
          data-testid={testId}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          sx={(theme) => ({
            position: 'relative',
            width: 32,
            height: 32,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            borderRadius: `${theme.ogs.radius.sm}px`,
            bgcolor: active ? 'action.selected' : 'transparent',
            color: active ? 'info.main' : 'text.secondary',
            cursor: 'pointer',
            opacity: dimmed ? 0.6 : 1,
            '&:hover': { bgcolor: 'action.hover' },
            '&:focus-visible': { outline: `2px solid ${theme.palette.info.main}`, outlineOffset: -2 },
            // Left-edge spine, same signature as the tab strip.
            '&::before': active
              ? { content: '""', position: 'absolute', left: -5, top: 6, bottom: 6, width: 2, borderRadius: 1, bgcolor: 'info.main' }
              : {},
          })}
        >
          <Badge
            badgeContent={count ?? 0}
            color={badgeColor}
            max={99}
            invisible={!count}
            data-testid={`${testId}-count`}
            sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', minWidth: 14, height: 14, px: 0.5 } }}
          >
            <Icon glyph={glyph} size={16} />
          </Badge>
          {severity !== undefined && (
            <Box
              data-testid={`${testId}-severity`}
              sx={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', bgcolor: severity === 'error' ? 'error.main' : 'warning.main' }}
            />
          )}
        </Box>
      </span>
    </Tooltip>
  );
}

/**
 * The Explorer's menu — "where I am": a thin rail whose active item decides
 * what the panel shows. In a workspace it switches Arquivos / Git /
 * Terminais; at Início it holds the app's destinations. Badges carry what
 * needs attention (changed files, running terminals) without opening a view.
 */
export function ExplorerRail({ items }: { items: readonly RailItem[] }): React.ReactElement {
  return (
    <Box
      component="nav"
      aria-label="Menu do explorer"
      data-testid="explorer-rail"
      sx={{
        width: 42,
        flexShrink: 0,
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.75,
        py: 1,
      }}
    >
      {items.map((item) => (
        <RailButton key={item.testId} {...item} />
      ))}
    </Box>
  );
}

/** The panel body next to the rail: rail on the left, the active view filling the rest. */
export function ExplorerFrame({ rail, children }: { rail: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {rail}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{children}</Box>
    </Box>
  );
}
