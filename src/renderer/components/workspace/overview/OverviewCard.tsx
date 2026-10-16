import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../../ds/Icon.js';
import { Kicker } from '../../ds/Kicker.js';

interface OverviewCardProps {
  testId: string;
  glyph: LucideIcon;
  title: string;
  /** Trailing header link/button, e.g. "Abrir Diagnóstico". */
  action?: React.ReactNode;
  /** Pinned under the body, e.g. today's spend. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/** One read-only summary card on a Visão geral tab — links out, never edits in place. */
export function OverviewCard({ testId, glyph, title, action, footer, children }: OverviewCardProps): React.ReactElement {
  return (
    <Box
      data-testid={testId}
      sx={(theme) => ({
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: `${theme.ogs.radius.sm}px`,
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      })}
    >
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', px: 1.5, pt: 1.25, pb: 0.75 }}>
        <Icon glyph={glyph} size={14} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Kicker>{title}</Kicker>
        </Box>
        {action}
      </Stack>
      <Box sx={{ px: 1.5, pb: 1.25, flex: 1, minWidth: 0 }}>{children}</Box>
      {footer && (
        <Box sx={{ px: 1.5, py: 0.75, borderTop: 1, borderColor: 'divider', fontSize: '0.75rem', color: 'text.secondary' }}>
          {footer}
        </Box>
      )}
    </Box>
  );
}

interface OverviewLinkProps {
  testId: string;
  onClick: () => void;
  children: React.ReactNode;
}

/** A text-sized link-button — the overview's one interaction shape. */
export function OverviewLink({ testId, onClick, children }: OverviewLinkProps): React.ReactElement {
  return (
    <ButtonBase
      data-testid={testId}
      onClick={onClick}
      sx={{ fontSize: '0.75rem', color: 'secondary.main', '&:hover': { textDecoration: 'underline' } }}
    >
      {children}
    </ButtonBase>
  );
}

interface OverviewRowProps {
  testId: string;
  glyph?: LucideIcon;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
}

/** A dense, clickable summary line inside a card. */
export function OverviewRow({ testId, glyph, primary, secondary, trailing, onClick }: OverviewRowProps): React.ReactElement {
  const content = (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', width: '100%', minWidth: 0, py: 0.375 }}>
      {glyph && <Icon glyph={glyph} size={13} />}
      <Typography noWrap sx={{ fontSize: '0.8125rem', flexShrink: 1, minWidth: 0 }}>
        {primary}
      </Typography>
      {secondary && (
        <Typography noWrap sx={{ fontSize: '0.75rem', color: 'text.secondary', flexShrink: 2, minWidth: 0 }}>
          {secondary}
        </Typography>
      )}
      <Box sx={{ flexGrow: 1 }} />
      {trailing}
    </Stack>
  );
  if (!onClick) return <Box data-testid={testId}>{content}</Box>;
  return (
    <ButtonBase
      data-testid={testId}
      onClick={onClick}
      sx={(theme) => ({
        width: '100%',
        justifyContent: 'flex-start',
        px: 0.5,
        mx: -0.5,
        borderRadius: `${theme.ogs.radius.xs}px`,
        '&:hover': { bgcolor: 'action.hover' },
      })}
    >
      {content}
    </ButtonBase>
  );
}

/** The cards' grid: two columns when there is room, one when the Workbench is narrow. */
export function OverviewGrid({ testId, children }: { testId: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box
      data-testid={testId}
      sx={{
        p: 2,
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        alignItems: 'start',
        overflowY: 'auto',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </Box>
  );
}

/** Midday today, local time, as ISO — the history service compares local days, and midday never crosses one in any timezone. */
export function todayFilters(now: Date = new Date()): { from: string; to: string } {
  const midday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString();
  return { from: midday, to: midday };
}
