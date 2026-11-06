import type { IpcHandlers } from './dispatcher.js';
import type { DetectionService } from '../application/services/detection-service.js';
import type { DetectedKind } from '../../shared/detected.js';
import { asObject, asString, optParams } from './_validators.js';
import { DomainError } from '../domain/errors.js';

const KINDS: readonly DetectedKind[] = ['skill', 'agent', 'mcp', 'hook', 'instruction'];

export function buildDetectedHandlers(service: DetectionService): IpcHandlers {
  return {
    'detected.list': async (params) => {
      const raw = optParams(params, 'detected.list');
      const kinds = raw['kinds'];
      if (kinds === undefined) return service.list();
      if (!Array.isArray(kinds) || !kinds.every((k): k is DetectedKind => KINDS.includes(k as DetectedKind))) {
        throw new DomainError('validation', `kinds must be a subset of ${KINDS.join(', ')}`);
      }
      return service.list({ kinds });
    },

    'detected.import': async (params) => {
      const raw = asObject(params, 'detected.import');
      return service.import(asString(raw['id'], 'id'));
    },
  };
}
