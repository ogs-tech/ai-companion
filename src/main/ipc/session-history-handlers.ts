import type { IpcHandlers } from './dispatcher.js';
import type { SessionHistoryService } from '../application/services/session-history-service.js';
import type { SessionService } from '../application/services/session-service.js';
import type { HistoryFilters, HistoryScope } from '../../shared/session-history.js';
import { asObject, asString } from './_validators.js';
import { DomainError } from '../domain/errors.js';

function asHistoryScope(value: unknown, field: string): HistoryScope {
  const obj = asObject(value, field);
  if (obj['kind'] === 'all') return { kind: 'all' };
  if (obj['kind'] === 'workspace') {
    return { kind: 'workspace', workspaceId: asString(obj['workspaceId'], `${field}.workspaceId`) };
  }
  if (obj['kind'] === 'project') {
    return { kind: 'project', projectId: asString(obj['projectId'], `${field}.projectId`) };
  }
  throw new DomainError(
    'validation',
    `Invalid '${field}': expected {kind:'project',projectId} | {kind:'workspace',workspaceId} | {kind:'all'}`,
  );
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new DomainError('validation', `Invalid '${field}': expected an array of strings`);
  }
  return value as string[];
}

function asHistoryFilters(value: unknown, field: string): HistoryFilters {
  const obj = asObject(value, field);
  const filters: HistoryFilters = {};
  if (obj['models'] !== undefined) filters.models = asStringArray(obj['models'], `${field}.models`);
  if (obj['from'] !== undefined) filters.from = asString(obj['from'], `${field}.from`);
  if (obj['to'] !== undefined) filters.to = asString(obj['to'], `${field}.to`);
  if (obj['search'] !== undefined) filters.search = asString(obj['search'], `${field}.search`);
  return filters;
}

function asPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new DomainError('validation', `Invalid '${field}': expected a positive integer`);
  }
  return value;
}

export function buildSessionHistoryHandlers(
  service: SessionHistoryService,
  sessionService: Pick<SessionService, 'adoptConversation'>,
): IpcHandlers {
  return {
    'sessionHistory.list': async (params) => {
      const raw = asObject(params, 'sessionHistory.list');
      return service.list({
        scope: asHistoryScope(raw['scope'], 'scope'),
        ...(raw['filters'] === undefined ? {} : { filters: asHistoryFilters(raw['filters'], 'filters') }),
        ...(raw['cursor'] === undefined ? {} : { cursor: asString(raw['cursor'], 'cursor') }),
        ...(raw['limit'] === undefined ? {} : { limit: asPositiveInteger(raw['limit'], 'limit') }),
      });
    },
    'sessionHistory.stats': async (params) => {
      const raw = asObject(params, 'sessionHistory.stats');
      return service.stats({
        scope: asHistoryScope(raw['scope'], 'scope'),
        ...(raw['filters'] === undefined ? {} : { filters: asHistoryFilters(raw['filters'], 'filters') }),
      });
    },
    'sessionHistory.resume': async (params) => {
      const raw = asObject(params, 'sessionHistory.resume');
      const claudeSessionId = asString(raw['claudeSessionId'], 'claudeSessionId');
      const entry = await service.find(claudeSessionId);
      if (!entry) {
        throw new DomainError('not_found', `No transcript for conversation '${claudeSessionId}'`, {
          claudeSessionId,
        });
      }
      return sessionService.adoptConversation({
        claudeSessionId,
        cwd: entry.cwd,
        label: entry.title ?? claudeSessionId.slice(0, 8),
      });
    },
  };
}
