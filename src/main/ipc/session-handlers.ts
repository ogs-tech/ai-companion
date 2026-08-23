import type { IpcHandlers } from './dispatcher.js';
import type { SessionService } from '../application/services/session-service.js';
import type { SessionAnchor } from '../../shared/session.js';
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

function asSessionAnchor(value: unknown, field: string): SessionAnchor {
  const obj = asObject(value, field);
  if (obj['kind'] === 'entity') return { kind: 'entity', urn: asString(obj['urn'], `${field}.urn`) };
  if (obj['kind'] === 'workspace') {
    return { kind: 'workspace', workspaceId: asString(obj['workspaceId'], `${field}.workspaceId`) };
  }
  if (obj['kind'] === 'project') {
    return { kind: 'project', projectId: asString(obj['projectId'], `${field}.projectId`) };
  }
  throw new DomainError(
    'validation',
    `Invalid '${field}': expected {kind:'entity',urn} | {kind:'workspace',workspaceId} | {kind:'project',projectId}`,
  );
}

export function buildSessionHandlers(service: SessionService): IpcHandlers {
  return {
    'session.spawn': async (params) => {
      const raw = asObject(params, 'session.spawn');
      return service.spawn(asSessionAnchor(raw['anchor'], 'anchor'));
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
