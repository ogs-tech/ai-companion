import { useSyncExternalStore } from 'react';
import { Box, Typography } from '@mui/material';
import { Globe, Plus } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { SectionAction, SectionHeader } from '../ds/ContainerChrome.js';
import { focusBrowserTab, getBrowserTabsSnapshot, openManualTab, subscribeBrowserTabs } from '../../lib/browser-tabs-store.js';

interface BrowserSectionProps {
  /** Workbench tab id (`browser:<tabId>`) of the focused tab, to mark its row. */
  activeWorkbenchTabId: string | null;
  onError: (message: string) => void;
}

/**
 * The Explorer's Navegador view: every browser page that exists, one row each.
 * Clicking a row focuses its Workbench tab (reopening it if it was closed);
 * "+" opens a new page. The Workbench tab strip's "+" is the shortcut — this
 * list is where you see what exists.
 */
export function BrowserSection({ activeWorkbenchTabId, onError }: BrowserSectionProps): React.ReactElement {
  const { tabs } = useSyncExternalStore(subscribeBrowserTabs, getBrowserTabsSnapshot);

  return (
    <Box data-testid="browser-section" sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <SectionHeader
        level="view"
        title="Navegador"
        testId="browser-header"
        count={tabs.length}
        actions={
          <SectionAction
            label="Novo navegador"
            testId="browser-new"
            glyph={Plus}
            onClick={() => void openManualTab().catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)))}
          />
        }
      />
      <Box sx={{ overflowY: 'auto', pb: 0.5 }}>
        {tabs.length === 0 && (
          <Typography variant="caption" color="text.secondary" data-testid="browser-empty" sx={{ display: 'block', px: 1.5, py: 0.75 }}>
            Nenhuma página aberta. Use + para abrir uma.
          </Typography>
        )}
        {tabs.map((tab) => {
          const active = activeWorkbenchTabId === `browser:${tab.tabId}`;
          return (
            <Box
              key={tab.tabId}
              role="button"
              tabIndex={0}
              data-testid={`browser-row-${tab.tabId}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => focusBrowserTab(tab.tabId)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                focusBrowserTab(tab.tabId);
              }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75, height: 26, pl: 1.5, pr: 1, cursor: 'pointer',
                bgcolor: active ? 'action.selected' : undefined,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Icon glyph={Globe} size={14} />
              <Typography component="span" sx={{ fontSize: '0.8rem', flex: 1, minWidth: 0 }} noWrap>
                {tab.url || 'Nova aba'}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
