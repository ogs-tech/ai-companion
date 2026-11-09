import { useState } from 'react';
import { Alert, Checkbox, FormControlLabel, FormGroup, Typography } from '@mui/material';
import { callIpc } from '../../lib/ipc.js';
import { queryClient } from '../../lib/query-client.js';
import { settingsQueryKey } from '../../hooks/use-settings.js';
import { useSettingsState } from '../../hooks/use-settings-state.js';
import { SyncReportModal } from '../../components/SyncReportModal.js';
import { ConfirmDisableModal } from '../settings/ConfirmDisableModal.js';
import { HARNESSES, type HarnessCapability, type HarnessId } from '../../../shared/harness.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import { ConfigPageFrame } from './ConfigPageFrame.js';

// What each harness capability promises, in this screen's own voice. The list of
// harnesses comes from the registry in shared/harness.ts — adding one there is
// enough to have it show up in the Config tree.
const CAPABILITY_LABEL: Record<HarnessCapability, string> = {
  manage: 'sincroniza suas customizações',
  run: 'executa sessões dentro do app',
};

/** One harness: its enable switch (gates `manage` and `run`) and what it does. */
export function HarnessPage({ harnessId }: { harnessId: HarnessId }): React.ReactElement {
  const { settings, refetch } = useSettingsState();
  const [syncReport, setSyncReport] = useState<SyncResult[]>([]);
  const [disableModal, setDisableModal] = useState<{ count: number } | null>(null);
  const [disableToast, setDisableToast] = useState<string | null>(null);
  const harness = HARNESSES[harnessId];

  const handleToggle = async (enabled: boolean): Promise<void> => {
    if (enabled) {
      const result = await callIpc<{ syncReport: SyncResult[] }>('adapter.setEnabled', { adapterId: harnessId, enabled: true });
      void queryClient.invalidateQueries({ queryKey: settingsQueryKey });
      await refetch();
      if (result.syncReport.some((e) => e.status !== 'ok')) setSyncReport(result.syncReport);
    } else {
      const { count } = await callIpc<{ count: number }>('adapter.countDestinations', { adapterId: harnessId });
      setDisableModal({ count });
    }
  };

  const handleDisableConfirm = async (removeSymlinks: boolean): Promise<void> => {
    setDisableModal(null);
    const result = await callIpc<{ removed: number; skipped: number; errors: unknown[] }>('adapter.setEnabled', {
      adapterId: harnessId,
      enabled: false,
      removeSymlinks,
    });
    void queryClient.invalidateQueries({ queryKey: settingsQueryKey });
    await refetch();
    if (removeSymlinks) {
      setDisableToast(`${result.removed} removidos, ${result.skipped} ignorados`);
      setTimeout(() => setDisableToast(null), 4000);
    }
  };

  return (
    <ConfigPageFrame title={harness.displayName} testId={`config-page-harness-${harnessId}`}>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
        Habilite o assistente para manter suas customizações sincronizadas.
      </Typography>
      <FormGroup>
        <FormControlLabel
          control={<Checkbox id={`adapter-${harnessId}`} checked={settings?.adapters[harnessId].enabled ?? false} disabled={settings === null} onChange={(e) => void handleToggle(e.target.checked)} />}
          label={harness.displayName}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.75 }}>
          {harness.capabilities.map((c) => CAPABILITY_LABEL[c]).join(' · ')}
        </Typography>
      </FormGroup>
      {disableModal !== null && (
        <ConfirmDisableModal
          adapterName={harness.displayName}
          count={disableModal.count}
          onConfirmRemove={() => void handleDisableConfirm(true)}
          onConfirmNoRemove={() => void handleDisableConfirm(false)}
          onCancel={() => setDisableModal(null)}
        />
      )}
      {disableToast !== null && (
        <Alert data-testid="disable-toast" role="status" severity="success" sx={{ mt: 2 }}>
          {disableToast}
        </Alert>
      )}
      <SyncReportModal report={syncReport} onClose={() => setSyncReport([])} />
    </ConfigPageFrame>
  );
}
