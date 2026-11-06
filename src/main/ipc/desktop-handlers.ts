import type { IpcHandlers } from './dispatcher.js';
import type { LoggerPort } from '../application/ports/logger-port.js';
import { DomainError } from '../domain/errors.js';
import { asBoolean, asObject, asOptString, asRawString, asString } from './_validators.js';

/** Window-bound side effects, injected so this module never touches `electron`. */
export interface DesktopDeps {
  logger: LoggerPort;
  setWindowTitle(title: string, edited: boolean): void;
  respondToQuit(requestId: string, proceed: boolean): void;
  openLogsFolder(): Promise<void>;
}

export function buildDesktopHandlers(deps: DesktopDeps): IpcHandlers {
  return {
    'desktop.setWindowTitle': async (params) => {
      const raw = asObject(params, 'desktop.setWindowTitle');
      deps.setWindowTitle(asRawString(raw['title'], 'title'), asBoolean(raw['edited'], 'edited'));
    },
    'desktop.respondToQuit': async (params) => {
      const raw = asObject(params, 'desktop.respondToQuit');
      deps.respondToQuit(asString(raw['requestId'], 'requestId'), asBoolean(raw['proceed'], 'proceed'));
    },
    'desktop.reportError': async (params) => {
      const raw = asObject(params, 'desktop.reportError');
      if (raw['source'] !== 'renderer') {
        throw new DomainError('validation', "Missing or invalid 'source' (must be renderer)");
      }
      deps.logger.error({
        process: 'renderer',
        message: asRawString(raw['message'], 'message'),
        stack: asOptString(raw['stack'], 'stack'),
      });
    },
    'desktop.openLogsFolder': async () => {
      await deps.openLogsFolder();
    },
  };
}
