import { Checkbox, FormControlLabel, FormGroup } from '@mui/material';
import { callIpc } from '../../lib/ipc.js';
import { queryClient } from '../../lib/query-client.js';
import { settingsQueryKey } from '../../hooks/use-settings.js';
import { useSettingsState } from '../../hooks/use-settings-state.js';
import type { Settings } from '../../../shared/settings.js';
import { ConfigPageFrame } from './ConfigPageFrame.js';

export function EditorPage(): React.ReactElement {
  const { settings, publish } = useSettingsState();
  const setUiPref = async (key: 'wordWrap' | 'confirmTrash', value: boolean): Promise<void> => {
    try {
      const next = await callIpc<Settings>('settings.merge', { ui: { [key]: value } });
      publish(next);
      await queryClient.invalidateQueries({ queryKey: settingsQueryKey });
    } catch (err) {
      console.warn('Could not save the preference', err);
    }
  };
  return (
    <ConfigPageFrame title="Editor e Explorer" testId="config-page-editor">
      <FormGroup sx={{ mt: 1 }}>
        <FormControlLabel
          control={<Checkbox checked={settings?.ui?.wordWrap ?? true} disabled={settings === null} onChange={(e) => void setUiPref('wordWrap', e.target.checked)} />}
          label="Quebra de linha nos editores"
        />
        <FormControlLabel
          control={<Checkbox checked={settings?.ui?.confirmTrash ?? true} disabled={settings === null} onChange={(e) => void setUiPref('confirmTrash', e.target.checked)} />}
          label="Confirmar antes de mover para a lixeira"
        />
      </FormGroup>
    </ConfigPageFrame>
  );
}
