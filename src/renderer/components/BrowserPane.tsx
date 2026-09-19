import { useEffect, useRef, useState } from 'react';
import { Box, Stack, TextField } from '@mui/material';
import { callIpc } from '../lib/ipc.js';

interface BrowserPaneProps {
  sessionId: string;
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The renderer half of the embedded browser: a URL bar plus the region a
 * main-process `WebContentsView` is positioned against. `WebContentsView` is
 * an Electron main-process construct layered on top of the window, invisible
 * to the renderer's own DOM — unlike an iframe, it can't be rendered here
 * directly. This region only reports its own bounds (via `ResizeObserver`,
 * the same mechanism `SessionPanel` already uses for xterm's `FitAddon`) so
 * the main process can `setBounds` the real view to match; the actual page
 * content lives entirely outside this component's DOM.
 */
export function BrowserPane({ sessionId }: BrowserPaneProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [addressBarValue, setAddressBarValue] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await callIpc<{ url: string } | null>('browser.status', { sessionId });
        if (active && status) setAddressBarValue(status.url);
      } catch {
        // No status yet — stays blank until the first navigate.
      }
    })();
    return () => {
      active = false;
    };
  }, [sessionId]);

  useEffect(() => {
    const syncBounds = (): void => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      void callIpc('browser.setBounds', {
        sessionId,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    };
    syncBounds();
    window.addEventListener('resize', syncBounds);
    const resizeObserver = new ResizeObserver(syncBounds);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => {
      window.removeEventListener('resize', syncBounds);
      resizeObserver.disconnect();
    };
  }, [sessionId]);

  const navigate = async (target: string): Promise<void> => {
    if (!target.trim()) return;
    const normalized = URL_SCHEME_RE.test(target) ? target : `https://${target}`;
    await callIpc('browser.navigate', { sessionId, url: normalized }).catch(() => {
      // Surfaced nowhere yet — a failed navigation just leaves the address bar as typed.
    });
    setAddressBarValue(normalized);
  };

  return (
    <Box data-testid="browser-pane" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1, py: 0.75, alignItems: 'center', borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        <TextField
          size="small"
          fullWidth
          value={addressBarValue}
          onChange={(event) => setAddressBarValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void navigate(addressBarValue);
          }}
          placeholder="Digite um endereço"
          slotProps={{ htmlInput: { 'data-testid': 'browser-address-bar' } }}
        />
      </Stack>
      <Box ref={containerRef} data-testid="browser-view-region" sx={{ flexGrow: 1, minHeight: 0 }} />
    </Box>
  );
}
