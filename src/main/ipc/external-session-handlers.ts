import type { IpcHandlers } from './dispatcher.js';
import type { ExternalSessionService } from '../application/services/external-session-service.js';
import type { ExternalHooksInstaller } from '../application/services/external-hooks-installer.js';
import type { SessionService } from '../application/services/session-service.js';
import { CHANNEL_IDS, type ChannelId } from '../../shared/channel.js';
import type { ExternalSessionsState } from '../../shared/external-session.js';
import { DomainError } from '../domain/errors.js';
import { asObject, asString } from './_validators.js';

export interface ExternalSessionHandlerDeps {
  external: Pick<ExternalSessionService, 'list' | 'tail' | 'setMode'>;
  installer: Pick<ExternalHooksInstaller, 'consent' | 'setConsent' | 'revoke' | 'installed'>;
  sessions: Pick<SessionService, 'adoptConversation'>;
  /** Harnesses whose CLI/config exist on this machine; hooks are only installed for these. */
  presentHarnesses: () => Promise<readonly ChannelId[]>;
  /** The renderer reports which session tab is focused, so a notification can be silenced for it. */
  setFocusedSession: (sessionId: string | null) => void;
  /** Called after any consent change so main can restart the notifier / emit a push. */
  onChanged: () => void;
}

export function buildExternalSessionHandlers(deps: ExternalSessionHandlerDeps): IpcHandlers {
  const state = async (): Promise<ExternalSessionsState> => {
    const consent = await deps.installer.consent();
    const hooksInstalled = Object.fromEntries(
      await Promise.all(CHANNEL_IDS.map(async (id) => [id, await deps.installer.installed(id)] as const)),
    ) as Record<ChannelId, boolean>;
    return { consent, hooksInstalled, sessions: consent === 'unset' ? [] : deps.external.list() };
  };

  return {
    'externalSession.state': async () => state(),
    'externalSession.setConsent': async (params) => {
      const mode = asString(asObject(params, 'externalSession.setConsent')['mode'], 'mode');
      if (mode !== 'exact' && mode !== 'estimated') throw new DomainError('validation', "Invalid 'mode': expected 'exact' | 'estimated'");
      await deps.installer.setConsent(mode, mode === 'exact' ? await deps.presentHarnesses() : []);
      await deps.external.setMode(mode);
      deps.onChanged();
      return state();
    },
    'externalSession.revokeConsent': async () => {
      await deps.installer.revoke();
      await deps.external.setMode('off');
      deps.onChanged();
      return state();
    },
    /** Read-only view of an external conversation: the last lines of its transcript. */
    'externalSession.tail': async (params) => {
      const id = asString(asObject(params, 'externalSession.tail')['id'], 'id');
      return deps.external.tail(id);
    },
    /** "Assumir aqui": resumes the conversation inside the app. Refused while the external one is still working or waiting — never kills it. */
    'externalSession.assume': async (params) => {
      const id = asString(asObject(params, 'externalSession.assume')['id'], 'id');
      const found = deps.external.list().find((s) => s.id === id);
      if (!found) throw new DomainError('not_found', `Unknown external session '${id}'`, { id });
      if (!found.closed && found.activity !== 'idle') {
        throw new DomainError('validation', 'A sessão externa ainda está em uso; espere ela ficar ociosa ou feche-a.');
      }
      if (!found.cwd) throw new DomainError('validation', 'Diretório da sessão externa desconhecido.');
      return deps.sessions.adoptConversation({ conversationId: found.id, harness: found.harness, cwd: found.cwd, label: found.label });
    },
    'session.setFocused': async (params) => {
      const raw = asObject(params, 'session.setFocused')['sessionId'];
      deps.setFocusedSession(typeof raw === 'string' && raw !== '' ? raw : null);
      return null;
    },
  };
}
