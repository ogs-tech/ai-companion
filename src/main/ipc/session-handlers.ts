import type { IpcHandlers } from './dispatcher.js';
import type { SessionService } from '../application/services/session-service.js';
import { asObject, asString } from './_validators.js';
import { DomainError } from '../domain/errors.js';

function asRawString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new DomainError('validation', `Missing or invalid '${field}'`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DomainError('validation', `Missing or invalid '${field}'`);
  }
  return value;
}

export function buildSessionHandlers(service: SessionService): IpcHandlers {
  return {
    'session.spawn': async (params) => {
      const raw = asObject(params, 'session.spawn');
      return service.spawn(asString(raw['entityUrn'], 'entityUrn'));
    },
    'session.write': async (params) => {
      const raw = asObject(params, 'session.write');
      service.write(asString(raw['sessionId'], 'sessionId'), asRawString(raw['data'], 'data'));
    },
    'session.resize': async (params) => {
      const raw = asObject(params, 'session.resize');
      service.resize(
        asString(raw['sessionId'], 'sessionId'),
        asNumber(raw['cols'], 'cols'),
        asNumber(raw['rows'], 'rows'),
      );
    },
    'session.kill': async (params) => {
      const raw = asObject(params, 'session.kill');
      service.kill(asString(raw['sessionId'], 'sessionId'));
    },
    'session.status': async (params) => {
      const raw = asObject(params, 'session.status');
      return service.status(asString(raw['sessionId'], 'sessionId')) ?? null;
    },
  };
}
