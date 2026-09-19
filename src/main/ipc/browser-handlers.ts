import type { IpcHandlers } from './dispatcher.js';
import type { SessionService } from '../application/services/session-service.js';
import type { EmbeddedBrowserPort } from '../application/ports/embedded-browser-port.js';
import { asObject, asString } from './_validators.js';
import { DomainError } from '../domain/errors.js';

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DomainError('validation', `Missing or invalid '${field}'`);
  }
  return value;
}

/**
 * `enable`/`disable` go through `SessionService` — turning a session's
 * browser tab on/off mutates the session's own `browserEnabled` flag and
 * (for `enable`) needs the resulting `mcpConfigPath` threaded into the
 * session's *next* spawn. `openTab`/`closeTab` are the manual-tab
 * equivalent — no session, no MCP config — and `navigate`/`setBounds`/
 * `status` are pure `WebContentsView` operations shared by both tab flavors
 * (`tabId` is either a `sessionId` or a manual tab's own id), so all of those
 * talk to the port directly.
 */
export function buildBrowserHandlers(service: SessionService, embeddedBrowser: EmbeddedBrowserPort): IpcHandlers {
  return {
    'browser.enable': async (params) => {
      const raw = asObject(params, 'browser.enable');
      await service.setBrowserEnabled(asString(raw['sessionId'], 'sessionId'), true);
    },
    'browser.disable': async (params) => {
      const raw = asObject(params, 'browser.disable');
      await service.setBrowserEnabled(asString(raw['sessionId'], 'sessionId'), false);
    },
    'browser.openTab': async (params) => {
      const raw = asObject(params, 'browser.openTab');
      const url = raw['url'];
      return embeddedBrowser.openTab(typeof url === 'string' ? url : undefined);
    },
    'browser.closeTab': async (params) => {
      const raw = asObject(params, 'browser.closeTab');
      await embeddedBrowser.closeTab(asString(raw['tabId'], 'tabId'));
    },
    'browser.navigate': async (params) => {
      const raw = asObject(params, 'browser.navigate');
      await embeddedBrowser.navigate(asString(raw['tabId'], 'tabId'), asString(raw['url'], 'url'));
    },
    'browser.setBounds': async (params) => {
      const raw = asObject(params, 'browser.setBounds');
      const bounds = asObject(raw['bounds'], 'bounds');
      embeddedBrowser.setBounds(asString(raw['tabId'], 'tabId'), {
        x: asNumber(bounds['x'], 'bounds.x'),
        y: asNumber(bounds['y'], 'bounds.y'),
        width: asNumber(bounds['width'], 'bounds.width'),
        height: asNumber(bounds['height'], 'bounds.height'),
      });
    },
    'browser.status': async (params) => {
      const raw = asObject(params, 'browser.status');
      return embeddedBrowser.status(asString(raw['tabId'], 'tabId'));
    },
  };
}
