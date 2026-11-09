import { useState } from 'react';
import { FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { Info } from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { SyncReportModal } from '../../components/SyncReportModal.js';
import { callIpc } from '../../lib/ipc.js';
import { useSettingsState } from '../../hooks/use-settings-state.js';
import type { LanguagePreference, Settings } from '../../../shared/settings.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import { ConfigPageFrame } from './ConfigPageFrame.js';

const LANGUAGE_OPTIONS: { value: LanguagePreference; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'mirror', label: 'Mirror (same as user)' },
  { value: 'pt-BR', label: 'Português (pt-BR)' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

export function LanguagePage(): React.ReactElement {
  const { settings, publish } = useSettingsState();
  const [loading, setLoading] = useState(false);
  const [syncReport, setSyncReport] = useState<SyncResult[]>([]);

  const handleChange = async (language: LanguagePreference): Promise<void> => {
    setLoading(true);
    try {
      const result = await callIpc<{ settings: Settings; syncReport: SyncResult[] }>('settings.setLanguage', { language });
      publish(result.settings);
      if (result.syncReport.some((e) => e.status !== 'ok')) setSyncReport(result.syncReport);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ConfigPageFrame title="Language" testId="config-page-language">
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
        Controls the language prompt in your global instructions.
      </Typography>
      <FormControl size="small" sx={{ minWidth: 240 }}>
        <InputLabel id="language-select-label">Language</InputLabel>
        <Select
          labelId="language-select-label"
          label="Language"
          value={settings?.language ?? 'off'}
          disabled={loading || settings === null}
          onChange={(e) => void handleChange(e.target.value as LanguagePreference)}
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {settings !== null && settings.language !== 'off' && (
        <Stack direction="row" sx={{ mt: 1.5, gap: 0.5, alignItems: 'center', color: 'text.secondary' }}>
          <Icon glyph={Info} size={16} />
          <Typography variant="caption">Code, comments, and test descriptions are always written in English.</Typography>
        </Stack>
      )}
      <SyncReportModal report={syncReport} onClose={() => setSyncReport([])} />
    </ConfigPageFrame>
  );
}
