import { Box, Chip, IconButton, List, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import { ChevronsLeft, SquareTerminal, X } from 'lucide-react';
import { useSessionFocus } from '../../lib/session-focus-context.js';
import { anchorKindLabel } from '../../lib/session-anchor-label.js';
import { SessionPanel } from '../SessionPanel.js';
import { Icon } from '../ds/Icon.js';
import { Kicker } from '../ds/Kicker.js';
import { TreeGroupRow } from '../workspace/TreeGroup.js';

/**
 * Persistent, always-reachable list of open agent sessions, docked to the
 * AppShell — not scoped to WorkspaceScreen — so switching Area never
 * unmounts a running terminal. Every open tab's SessionPanel stays mounted
 * for the panel's whole lifetime (only `display` toggles), because there's
 * no server-side scrollback buffer: unmounting one would lose its history.
 */
export function SessionsPanel(): React.ReactElement | null {
  const { openTabs, focusedSessionId, expanded, focusSession, toggleExpanded, closeTab } = useSessionFocus();
  const theme = useTheme();

  if (openTabs.length === 0) return null;

  return (
    <Box data-testid="sessions-panel" sx={{ display: 'flex', borderLeft: 1, borderColor: 'divider' }}>
      {expanded ? (
        <Box sx={{ width: 300, display: 'flex', flexDirection: 'column', borderRight: 1, borderColor: 'divider' }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Icon glyph={SquareTerminal} size={16} />
              <Kicker>Sessões</Kicker>
            </Stack>
            <IconButton
              size="small"
              data-testid="sessions-panel-collapse"
              aria-label="Recolher sessões"
              onClick={toggleExpanded}
            >
              <Icon glyph={ChevronsLeft} size={16} />
            </IconButton>
          </Stack>
          <List disablePadding sx={{ overflowY: 'auto' }}>
            {openTabs.map((tab) => {
              const focused = tab.sessionId === focusedSessionId;
              return (
                <TreeGroupRow
                  key={tab.sessionId}
                  testId={`sessions-panel-tab-${tab.sessionId}`}
                  glyph={SquareTerminal}
                  accentColor={theme.palette.success.main}
                  primary={
                    <Typography noWrap sx={{ fontSize: '0.85rem', fontWeight: focused ? 600 : 400 }}>
                      {tab.label}
                    </Typography>
                  }
                  badge={
                    <Chip size="small" variant="outlined" label={anchorKindLabel(tab.anchor)} sx={{ height: 18, fontSize: '0.6875rem' }} />
                  }
                  onClick={() => focusSession(tab.anchor, tab.label)}
                  actions={
                    <Tooltip title="Fechar">
                      <Box
                        component="span"
                        role="button"
                        tabIndex={0}
                        aria-label={`Fechar ${tab.label}`}
                        data-testid={`sessions-panel-tab-close-${tab.sessionId}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.sessionId);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          if (e.key === ' ') e.preventDefault();
                          e.stopPropagation();
                          closeTab(tab.sessionId);
                        }}
                        sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
                      >
                        <Icon glyph={X} size={14} />
                      </Box>
                    </Tooltip>
                  }
                />
              );
            })}
          </List>
        </Box>
      ) : (
        <Box
          data-testid="sessions-panel-expand"
          role="button"
          tabIndex={0}
          aria-label="Expandir sessões"
          onClick={toggleExpanded}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.key === ' ') e.preventDefault();
            toggleExpanded();
          }}
          sx={{ width: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, pt: 1.5, cursor: 'pointer' }}
        >
          <Icon glyph={SquareTerminal} size={18} />
          <Chip size="small" label={openTabs.length} sx={{ height: 18, fontSize: '0.6875rem', '& .MuiChip-label': { px: 0.75 } }} />
        </Box>
      )}
      <Box sx={{ display: expanded ? 'flex' : 'none', flexDirection: 'column', flex: 1, minWidth: 0, p: 1.5 }}>
        {openTabs.map((tab) => {
          const visible = expanded && tab.sessionId === focusedSessionId;
          return (
            <Box
              key={tab.sessionId}
              data-testid={`sessions-panel-stage-${tab.sessionId}`}
              sx={{ display: visible ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
            >
              <SessionPanel anchor={tab.anchor} visible={visible} />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
