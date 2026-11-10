import { useEffect, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, FormGroup, Paper, Stack, Typography } from '@mui/material';
import { Kicker } from '../../components/ds/Kicker.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { CHANNELS } from '../../../shared/channel.js';
import { resolveSessionSettings, type Settings, type SessionSettings } from '../../../shared/settings.js';
import type { ExternalSessionsState } from '../../../shared/external-session.js';

const TOGGLES: ReadonlyArray<{ key: keyof SessionSettings; label: string }> = [
  { key: 'notifyAsk', label: 'Notificar quando uma sessão passar a Pergunta' },
  { key: 'notifyLongTurn', label: 'Notificar quando um turno longo (mais de 2 min) terminar' },
  { key: 'notifyExternal', label: 'Incluir sessões externas nas notificações e no badge' },
  { key: 'silenceFocused', label: 'Silenciar a sessão que está em foco' },
  { key: 'dockBadge', label: 'Contar sessões em Pergunta no badge do Dock' },
  { key: 'notifyContext', label: 'Avisar uma vez quando o contexto passar de 90%' },
  { key: 'notifyCost', label: 'Avisar quando o custo passar de US$ 5 e US$ 10' },
  { key: 'inlineAnswer', label: 'Responder pedidos de permissão direto da lista (apenas sessões do app)' },
];

interface Props {
  settings: Settings;
  onSaved: (next: Settings) => void;
}

/** Status of the signal hooks in the harnesses' own config + the session notification preferences. */
export function SessionsSettingsSection({ settings, onSaved }: Props): React.ReactElement {
  const [external, setExternal] = useState<ExternalSessionsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefs = resolveSessionSettings(settings);

  // Bumped by pushes from main and by this section's own consent changes; the effect refetches on every bump.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const state = await callIpc<ExternalSessionsState>('externalSession.state');
        if (active) setExternal(state && typeof state.consent === 'string' && state.hooksInstalled ? state : null);
      } catch {
        if (active) setExternal(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [version]);
  useEffect(() => window.api.externalSession.onChanged(() => setVersion((v) => v + 1)), []);

  const setPref = async (key: keyof SessionSettings, value: boolean): Promise<void> => {
    try {
      onSaved(await callIpc<Settings>('settings.merge', { sessions: { [key]: value } }));
    } catch (err) {
      setError(err instanceof IpcCallError ? err.message : String(err));
    }
  };

  const setConsent = async (method: 'externalSession.setConsent' | 'externalSession.revokeConsent', mode?: 'exact' | 'estimated'): Promise<void> => {
    setError(null);
    try {
      await callIpc(method, mode ? { mode } : undefined);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof IpcCallError ? err.message : String(err));
    }
  };

  return (
    <Paper component="section" variant="outlined" sx={{ p: 3, mb: 3 }} data-testid="sessions-settings">
      <Kicker component="h2">Sessões</Kicker>

      {external && (
        <Box sx={{ mt: 1, mb: 2 }} data-testid="external-consent-settings">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Sessões fora do app
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            {external.consent === 'exact'
              ? 'Estado exato: hooks do app instalados nos arquivos de configuração dos assistentes.'
              : external.consent === 'estimated'
                ? 'Só estimado: nada foi alterado nos arquivos dos assistentes.'
                : 'Ainda não escolhido.'}
          </Typography>
          {external.consent === 'exact' &&
            (Object.keys(external.hooksInstalled) as Array<keyof typeof external.hooksInstalled>).map((id) => (
              <Typography key={id} variant="caption" sx={{ display: 'block' }} data-testid={`signal-health-${id}`}>
                {`${CHANNELS[id].displayName}: ${external.hooksInstalled[id] ? 'instalado (sessões já abertas só reportam após recarregar o assistente)' : 'não instalado'}`}
              </Typography>
            ))}
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            {external.consent !== 'exact' && (
              <Button size="small" variant="outlined" onClick={() => void setConsent('externalSession.setConsent', 'exact')}>
                Ativar estado exato
              </Button>
            )}
            {external.consent !== 'estimated' && (
              <Button size="small" onClick={() => void setConsent('externalSession.setConsent', 'estimated')}>
                Só estimado
              </Button>
            )}
            {external.consent !== 'unset' && (
              <Button size="small" color="warning" onClick={() => void setConsent('externalSession.revokeConsent')}>
                Remover hooks e consentimento
              </Button>
            )}
          </Stack>
        </Box>
      )}

      <FormGroup>
        {TOGGLES.map(({ key, label }) => (
          <FormControlLabel
            key={key}
            control={<Checkbox checked={prefs[key]} onChange={(e) => void setPref(key, e.target.checked)} />}
            label={label}
          />
        ))}
      </FormGroup>
      {error && (
        <Typography variant="caption" color="error" role="alert">
          {error}
        </Typography>
      )}
    </Paper>
  );
}
