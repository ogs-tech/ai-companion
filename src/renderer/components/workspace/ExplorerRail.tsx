import { Badge, Box, Tooltip } from '@mui/material';
import { FolderTree, GitBranch, House, SquareTerminal, type LucideIcon } from 'lucide-react';
import { Icon } from '../ds/Icon.js';

export type ExplorerView = 'files' | 'git' | 'terminals';

interface ExplorerRailProps {
  /** `null` at Início, where no view is active and the workspace views are unavailable. */
  view: ExplorerView | null;
  onSelect: (view: ExplorerView) => void;
  /** Files with changes; hidden at 0 and outside a repository. */
  gitCount?: number;
  /** No repository: the Git icon dims but stays clickable, since that view offers "Inicializar git". */
  gitDimmed?: boolean;
  /** Running terminals. */
  terminalCount?: number;
  /** Início is the active context: Arquivos/Git/Terminais need an open workspace. */
  isHome: boolean;
  onGoHome: () => void;
}

interface RailItem {
  view: ExplorerView;
  label: string;
  glyph: LucideIcon;
  count?: number | undefined;
  dimmed?: boolean | undefined;
  badgeColor: 'warning' | 'success';
}

function RailButton({
  testId,
  label,
  glyph,
  active,
  disabled,
  dimmed = false,
  count,
  badgeColor,
  onClick,
}: {
  testId: string;
  label: string;
  glyph: LucideIcon;
  active: boolean;
  disabled: boolean;
  dimmed?: boolean;
  count?: number | undefined;
  badgeColor: 'warning' | 'success';
  onClick: () => void;
}): React.ReactElement {
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
          disabled={disabled}
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
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.4 : dimmed ? 0.6 : 1,
            '&:hover:not(:disabled)': { bgcolor: 'action.hover' },
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
        </Box>
      </span>
    </Tooltip>
  );
}

/**
 * The Explorer's menu: a thin rail that switches the panel between Arquivos,
 * Git and Terminais, with Início pinned at the bottom. Badges carry what needs
 * attention (changed files, running terminals) so it shows without opening a view.
 */
export function ExplorerRail({ view, onSelect, gitCount, gitDimmed, terminalCount, isHome, onGoHome }: ExplorerRailProps): React.ReactElement {
  const items: RailItem[] = [
    { view: 'files', label: 'Arquivos', glyph: FolderTree, badgeColor: 'warning' },
    { view: 'git', label: 'Git', glyph: GitBranch, count: gitCount, dimmed: gitDimmed, badgeColor: 'warning' },
    { view: 'terminals', label: 'Terminais', glyph: SquareTerminal, count: terminalCount, badgeColor: 'success' },
  ];
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
        <RailButton
          key={item.view}
          testId={`explorer-view-${item.view}`}
          label={item.label}
          glyph={item.glyph}
          active={!isHome && view === item.view}
          disabled={isHome}
          dimmed={item.dimmed === true}
          count={item.count}
          badgeColor={item.badgeColor}
          onClick={() => onSelect(item.view)}
        />
      ))}
      <Box sx={{ flex: 1 }} />
      <RailButton testId="explorer-view-home" label="Início" glyph={House} active={isHome} disabled={false} badgeColor="warning" onClick={onGoHome} />
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
