import type { IpcHandlers } from './dispatcher.js';
import type { ExternalFileService } from '../application/services/external-file-service.js';
import { asObject, asRawString, asString } from './_validators.js';
import { DomainError } from '../domain/errors.js';

export function buildExternalFileHandlers(service: ExternalFileService): IpcHandlers {
  return {
    'externalFile.pick': async () => service.pick(),
    'externalFile.grantDropped': async (params) => {
      const raw = asObject(params, 'externalFile.grantDropped');
      const paths = raw['paths'];
      if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) {
        throw new DomainError('validation', "Missing or invalid 'paths'");
      }
      return service.grantDropped(paths as string[]);
    },
    'externalFile.read': async (params) => {
      const raw = asObject(params, 'externalFile.read');
      return service.read(asString(raw['path'], 'path'));
    },
    'externalFile.write': async (params) => {
      const raw = asObject(params, 'externalFile.write');
      await service.write(asString(raw['path'], 'path'), asRawString(raw['content'], 'content'));
    },
  };
}
