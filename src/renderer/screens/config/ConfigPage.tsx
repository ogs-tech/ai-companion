import { Box, CircularProgress, Typography } from '@mui/material';
import { useSettingsState } from '../../hooks/use-settings-state.js';
import { SessionsSettingsSection } from '../settings/SessionsSettingsSection.js';
import { isChannelId } from '../../../shared/channel.js';
import { DangerPage } from './DangerPage.js';
import { EditorPage } from './EditorPage.js';
import { GitHubPage } from './GitHubPage.js';
import { ChannelPage } from './ChannelPage.js';
import { GitIgnorePage } from './GitIgnorePage.js';
import { LanguagePage } from './LanguagePage.js';
import { CHANNEL_PAGE_PREFIX, type ConfigPageId } from './config-pages.js';

function SessionsPage(): React.ReactElement {
  const { settings, publish } = useSettingsState();
  if (settings === null) return <Typography sx={{ p: 3, color: 'text.secondary' }}>Carregando…</Typography>;
  return (
    <Box data-testid="config-page-sessions" sx={{ p: 3, maxWidth: 760, mx: 'auto' }}>
      <SessionsSettingsSection settings={settings} onSaved={publish} />
    </Box>
  );
}

/** Pages that need no settings snapshot render straight away; the rest wait for it (no flash of defaults). */
const SETTINGS_FREE_PAGES: ReadonlySet<string> = new Set(['github', 'danger']);

/** The Workbench body of one Config tab. Every page edits the same global settings. */
export function ConfigPage({ page }: { page: ConfigPageId }): React.ReactElement {
  const { settings } = useSettingsState();
  if (settings === null && !SETTINGS_FREE_PAGES.has(page)) {
    return (
      <Box data-testid="settings-loading" sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 1.5, color: 'text.secondary' }}>
        <CircularProgress size={18} />
        <Typography>Carregando…</Typography>
      </Box>
    );
  }
  if (page.startsWith(CHANNEL_PAGE_PREFIX)) {
    const id = page.slice(CHANNEL_PAGE_PREFIX.length);
    if (isChannelId(id)) return <ChannelPage harnessId={id} />;
  }
  switch (page) {
    case 'sessions':
      return <SessionsPage />;
    case 'editor':
      return <EditorPage />;
    case 'language':
      return <LanguagePage />;
    case 'git-ignore':
      return <GitIgnorePage />;
    case 'github':
      return <GitHubPage />;
    case 'danger':
      return <DangerPage />;
    default:
      return <Typography sx={{ p: 3, color: 'text.secondary' }}>Página de configuração desconhecida.</Typography>;
  }
}
