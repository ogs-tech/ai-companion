import type { IpcHandlers } from './dispatcher.js';
import type { SessionService } from '../application/services/session-service.js';
import type { SessionAnchor } from '../../shared/session.js';
import { asObject, asString, asStringArray } from './_validators.js';
import { HARNESS_IDS, isHarnessId, type HarnessId } from '../../shared/harness.js';
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
    const workspaceId = asString(obj['workspaceId'], `${field}.workspaceId`);
    return obj['folders'] === undefined
      ? { kind: 'workspace', workspaceId }
      : { kind: 'workspace', workspaceId, folders: asStringArray(obj['folders'], `${field}.folders`) };
  }
  if (obj['kind'] === 'personal') return { kind: 'personal' };
  throw new DomainError(
    'validation',
    `Invalid '${field}': expected {kind:'entity',urn} | {kind:'workspace',workspaceId} | {kind:'personal'}`,
  );
}

function asHarness(value: unknown, field: string): HarnessId {
  if (typeof value === 'string' && isHarnessId(value)) return value;
  throw new DomainError('validation', `Invalid '${field}': expected one of ${HARNESS_IDS.join(' | ')}`);
}

export function buildSessionHandlers(service: SessionService): IpcHandlers {
  return {
    'session.spawn': async (params) => {
      const raw = asObject(params, 'session.spawn');
      const anchor = asSessionAnchor(raw['anchor'], 'anchor');
      return raw['harness'] === undefined ? service.spawn(anchor) : service.spawn(anchor, asHarness(raw['harness'], 'harness'));
    },
    'session.write': async (params) => {
      const raw = asObject(params, 'session.write');
      service.write(asString(raw['sessionId'], 'sessionId'), asRawString(raw['data'], 'data'));
    },
    'session.stageAttachment': async (params) => {
      const raw = asObject(params, 'session.stageAttachment');
      const absolutePath = await service.stageAttachment(
        asString(raw['fileName'], 'fileName'),
        asString(raw['dataBase64'], 'dataBase64'),
      );
      return { absolutePath };
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
    'session.remove': async (params) => {
      const raw = asObject(params, 'session.remove');
      await service.remove(asString(raw['sessionId'], 'sessionId'));
    },
    'session.resume': async (params) => {
      const raw = asObject(params, 'session.resume');
      return service.resume(asString(raw['sessionId'], 'sessionId'));
    },
    'session.status': async (params) => {
      const raw = asObject(params, 'session.status');
      return service.status(asString(raw['sessionId'], 'sessionId')) ?? null;
    },
    'session.list': async () => service.list(),
    'session.availableHarnesses': async () => service.availableHarnesses(),
  };
}
