import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { Icon } from './Icon.js';
import { treeGroupLabelSx } from './TreeRow.js';

interface ContainerHeaderProps {
  title: string;
  /** Prefix for the collapse button's test id (`${testId}-collapse`). */
  testId: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Quiet total after the title, e.g. the number of items. */
  count?: number;
  /** Live state after the count, e.g. "1 ativa". */
  status?: React.ReactNode;
  /** Right-aligned buttons (create, etc.). */
  actions?: React.ReactNode;
}

/**
 * The header every Control Panel container shares: collapse chevron, a
 * sentence-case title, a quiet count or live status, and right-aligned
 * actions. 40px tall, so the two containers read as the same kind of thing.
 */
export function ContainerHeader({ title, testId, collapsed, onToggle, count, status, actions }: ContainerHeaderProps): React.ReactElement {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', height: 40, flexShrink: 0, pl: 1.25, pr: 1 }}>
      <IconButton
        size="small"
        data-testid={`${testId}-collapse`}
        aria-label={collapsed ? `Mostrar ${title.toLowerCase()}` : `Ocultar ${title.toLowerCase()}`}
        onClick={onToggle}
        sx={{ p: 0.25, mr: -0.25 }}
      >
        <Icon glyph={collapsed ? ChevronRight : ChevronDown} size={14} />
      </IconButton>
      <Typography component="h3" sx={{ fontSize: '0.875rem', fontWeight: 600, lineHeight: '20px' }}>
        {title}
      </Typography>
      {count !== undefined && (
        <Typography component="span" data-testid={`${testId}-count`} sx={{ fontSize: '0.75rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {count}
        </Typography>
      )}
      {status}
      <Box sx={{ ml: 'auto !important', display: 'flex', alignItems: 'center' }}>{actions}</Box>
    </Stack>
  );
}

/** A 36px footer under a hairline: a summary on the left, one action on the right. */
export function ContainerFooter({ children, testId }: { children: React.ReactNode; testId?: string }): React.ReactElement {
  return (
    <Stack
      direction="row"
      {...(testId ? { 'data-testid': testId } : {})}
      sx={(theme) => ({
        alignItems: 'center', justifyContent: 'space-between', gap: 1, height: 36, flexShrink: 0, pl: 1.75, pr: 1.5,
        borderTop: `1px solid ${theme.palette.divider}`, fontSize: '0.75rem', color: 'text.secondary',
      })}
    >
      {children}
    </Stack>
  );
}

/** The footer's one action: ink text with a quiet underline — no arrow, no accent color. */
export function FooterLink({ children, onClick, testId }: { children: React.ReactNode; onClick: () => void; testId?: string }): React.ReactElement {
  return (
    <Box
      component="button"
      type="button"
      {...(testId ? { 'data-testid': testId } : {})}
      onClick={onClick}
      sx={{
        border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer', font: 'inherit', fontWeight: 500, color: 'text.primary', flexShrink: 0,
        textDecoration: 'underline', textDecorationColor: 'text.disabled', textUnderlineOffset: '3px',
      }}
    >
      {children}
    </Box>
  );
}

interface SectionActionProps {
  label: string;
  testId: string;
  glyph: LucideIcon;
  /** Receives the button, so an action can anchor a menu to it. */
  onClick: (anchor: HTMLElement) => void;
  disabled?: boolean;
  /** Set when the action opens a menu. */
  hasPopup?: boolean;
}

/** One quiet icon button in a {@link SectionHeader}; never toggles the section. */
export function SectionAction({ label, testId, glyph, onClick, disabled = false, hasPopup = false }: SectionActionProps): React.ReactElement {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          size="small"
          aria-label={label}
          data-testid={testId}
          disabled={disabled}
          {...(hasPopup ? { 'aria-haspopup': 'menu' as const } : {})}
          onClick={(e) => {
            e.stopPropagation();
            onClick(e.currentTarget);
          }}
          sx={{ p: 0.5 }}
        >
          <Icon glyph={glyph} size={13} />
        </IconButton>
      </span>
    </Tooltip>
  );
}

interface SectionHeaderProps {
  title: string;
  testId: string;
  /** Quiet total after the title. */
  count?: number;
  /** Set to make the header a toggle: `true` shows a closed chevron. Omit for a static header. */
  collapsed?: boolean;
  onToggle?: () => void;
  /** Right-aligned {@link SectionAction}s. */
  actions?: React.ReactNode;
}

/**
 * The compact header every Explorer Panel section shares — kicker-style
 * title, quiet count, right-aligned actions, optional collapse chevron. The
 * left panel's counterpart of {@link ContainerHeader} (which the right
 * panel's containers use).
 */
export function SectionHeader({ title, testId, count, collapsed, onToggle, actions }: SectionHeaderProps): React.ReactElement {
  const toggles = collapsed !== undefined && onToggle !== undefined;
  return (
    <Box
      data-testid={testId}
      {...(toggles ? { role: 'button', tabIndex: 0, 'aria-expanded': !collapsed, onClick: onToggle } : {})}
      {...(toggles
        ? {
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onToggle();
            },
          }
        : {})}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 28, flexShrink: 0, pl: 1, pr: 0.5, cursor: toggles ? 'pointer' : 'default' }}
    >
      {collapsed !== undefined && <Icon glyph={collapsed ? ChevronRight : ChevronDown} size={14} />}
      <Typography component="span" sx={{ ...treeGroupLabelSx, flex: 1, minWidth: 0 }} noWrap>
        {title}
      </Typography>
      {count !== undefined && (
        <Typography component="span" data-testid={`${testId}-count`} sx={{ fontSize: '0.6875rem', color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
          {count}
        </Typography>
      )}
      {actions}
    </Box>
  );
}
