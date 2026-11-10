import { useCallback, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, FormGroup, Typography } from '@mui/material';
import { callIpc } from '../../lib/ipc.js';
import { queryClient } from '../../lib/query-client.js';
import { settingsQueryKey } from '../../hooks/use-settings.js';
import { useSettingsState } from '../../hooks/use-settings-state.js';
import { SyncReportModal } from '../../components/SyncReportModal.js';
import { ConfirmDisableModal } from '../settings/ConfirmDisableModal.js';
import { CHANNELS, type ChannelCapability, type ChannelId } from '../../../shared/channel.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import { ConfigPageFrame } from './ConfigPageFrame.js';
import { ChannelSetupDialog } from './ChannelSetupDialog.js';
import { useChannelStatus, channelStatusQueryKey } from '../../hooks/use-channel-status.js';
import type { ChannelSetupAction, ChannelSetupStart } from '../../../shared/channel-setup.js';

// What each harness capability promises, in this screen's own voice. The list of
// channels comes from the registry in shared/channel.ts — adding one there is
// enough to have it show up in the Config tree.
const CAPABILITY_LABEL: Record<ChannelCapability, string> = {
  manage: 'sincroniza suas customizações',
  run: 'executa sessões dentro do app',
};

/** One setup step: ✓ when done, ○ when pending, greyed while an earlier step blocks it. */
function Step({ done, blocked = false, children }: { done: boolean; blocked?: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <Box component="li" sx={{ display: 'flex', gap: 1, alignItems: 'center', color: blocked ? 'text.disabled' : 'text.primary' }}>
      <Box component="span" aria-hidden sx={{ width: 16, textAlign: 'center', color: done ? 'success.main' : 'text.secondary' }}>
        {done ? '✓' : '○'}
      </Box>
      <Typography variant="body2" component="span">
        {children}
        <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {done ? ' (concluído)' : ' (pendente)'}
        </Box>
      </Typography>
    </Box>
  );
}

/** One channel: where it stands (installed → signed in), the next step as one button, and its enable switch once it is ready. */
export function ChannelPage({ harnessId }: { harnessId: ChannelId }): React.ReactElement {
  const { settings, refetch } = useSettingsState();
  const [syncReport, setSyncReport] = useState<SyncResult[]>([]);
  const [disableModal, setDisableModal] = useState<{ count: number } | null>(null);
  const [disableToast, setDisableToast] = useState<string | null>(null);
  const harness = CHANNELS[harnessId];
  const statusQuery = useChannelStatus(harnessId);
  const channelStatus = statusQuery.data;
  const [setupTerminal, setSetupTerminal] = useState<{ terminalId: string; title: string; action: ChannelSetupAction } | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const { setup } = harness;
  const installed = channelStatus?.installed ?? false;
  const signedIn = channelStatus?.signedIn ?? null; // null: no account (or not known yet)
  const ready = installed && (setup.auth === null || signedIn === true);

  const recheck = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: channelStatusQueryKey(harnessId) });
  }, [harnessId]);

  const startSetup = async (action: ChannelSetupAction): Promise<void> => {
    setSetupError(null);
    try {
      const result = await callIpc<ChannelSetupStart>('channelSetup.start', { channelId: harnessId, action });
      if (result.kind === 'terminal') setSetupTerminal({ terminalId: result.terminalId, title: result.title, action });
    } catch (err) {
      setSetupError((err as Error).message);
    }
  };

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
    <ConfigPageFrame title={harness.displayName} testId={`config-page-channel-${harnessId}`}>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
        {channelStatus === undefined
          ? 'Verificando…'
          : !installed
            ? `${harness.displayName} não está instalado neste computador.`
            : `Instalado${channelStatus.version ? ` · ${channelStatus.version}` : ''}${setup.auth === null ? '' : signedIn ? ' · conta conectada' : ' · sem conta'}`}
      </Typography>
      {channelStatus !== undefined && (
        <Box component="ul" data-testid="channel-steps" sx={{ listStyle: 'none', m: 0, mb: 2, p: 0, display: 'grid', gap: 0.75 }}>
          <Step done={installed}>{setup.install.kind === 'download' ? `Instalar o app ${harness.displayName}` : 'Instalar'}</Step>
          {setup.auth !== null && (
            <Step done={signedIn === true} blocked={!installed}>
              Entrar na conta
            </Step>
          )}
          <Step done={ready && (settings?.adapters[harnessId].enabled ?? false)} blocked={!ready}>
            {harness.capabilities.map((c) => CAPABILITY_LABEL[c]).join(' e ')}
          </Step>
        </Box>
      )}
      {channelStatus !== undefined && !installed && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
          <Button variant="contained" onClick={() => void startSetup('install')}>
            {setup.install.kind === 'download' ? `Baixar ${harness.displayName}` : 'Instalar'}
          </Button>
          {setup.install.kind === 'command' && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {setup.install.command}
            </Typography>
          )}
          {setup.install.kind === 'download' && (
            <Typography variant="caption" color="text.secondary">
              Abra o app uma vez para o comando <code>{setup.bin}</code> ficar disponível e volte aqui.
            </Typography>
          )}
        </Box>
      )}
      {installed && setup.auth !== null && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
          <Button variant={signedIn ? 'outlined' : 'contained'} color={signedIn ? 'inherit' : 'secondary'} onClick={() => void startSetup('login')}>
            {signedIn ? 'Entrar com outra conta' : 'Entrar'}
          </Button>
          {!signedIn && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {setup.auth.loginCommand}
            </Typography>
          )}
        </Box>
      )}
      {setupError !== null && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {setupError}
        </Alert>
      )}
      {(ready || (settings?.adapters[harnessId].enabled ?? false)) && (
        <FormGroup>
          <FormControlLabel
            control={<Checkbox id={`adapter-${harnessId}`} checked={settings?.adapters[harnessId].enabled ?? false} disabled={settings === null} onChange={(e) => void handleToggle(e.target.checked)} />}
            label={`Ativar ${harness.displayName}`}
          />
        </FormGroup>
      )}
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
      {setupTerminal !== null && (
        <ChannelSetupDialog
          terminalId={setupTerminal.terminalId}
          title={setupTerminal.title}
          {...(setupTerminal.action === 'install' && setup.auth !== null
            ? { next: { label: 'Entrar agora', onClick: () => { setSetupTerminal(null); void startSetup('login'); } } }
            : {})}
          onExited={recheck}
          onClose={() => {
            setSetupTerminal(null);
            recheck();
          }}
        />
      )}
      <SyncReportModal report={syncReport} onClose={() => setSyncReport([])} />
    </ConfigPageFrame>
  );
}
