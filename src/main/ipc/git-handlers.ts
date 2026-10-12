import type { IpcHandlers } from './dispatcher.js';
import type { GitService } from '../application/services/git-service.js';
import type { GitDiffSource } from '../../shared/git.js';
import { DomainError } from '../domain/errors.js';
import {
  asBoolean,
  asObject,
  asRawString,
  asString,
  asStringArray,
  optParams,
} from './_validators.js';

function asDiffSource(value: unknown): GitDiffSource {
  const raw = asObject(value, 'source');
  const kind = raw['kind'];
  if (kind === 'worktree' || kind === 'index') return { kind };
  if (kind === 'commit') return { kind, sha: asString(raw['sha'], 'source.sha') };
  throw new DomainError(
    'validation',
    "Missing or invalid 'source.kind' (must be worktree | index | commit)",
  );
}

export function buildGitHandlers(service: GitService): IpcHandlers {
  return {
    'git.status': async (params) => {
      optParams(params, 'git.status');
      return service.status();
    },
    'git.diff': async (params) => {
      const raw = asObject(params, 'git.diff');
      return service.diff(asString(raw['path'], 'path'), asDiffSource(raw['source']));
    },
    'git.stage': async (params) => {
      const raw = asObject(params, 'git.stage');
      return service.stage(asStringArray(raw['paths'], 'paths'));
    },
    'git.unstage': async (params) => {
      const raw = asObject(params, 'git.unstage');
      return service.unstage(asStringArray(raw['paths'], 'paths'));
    },
    'git.discard': async (params) => {
      const raw = asObject(params, 'git.discard');
      return service.discard(asStringArray(raw['paths'], 'paths'));
    },
    'git.commit': async (params) => {
      const raw = asObject(params, 'git.commit');
      return service.commit(
        asRawString(raw['message'], 'message'),
        raw['amend'] === undefined ? false : asBoolean(raw['amend'], 'amend'),
      );
    },
    'git.init': async (params) => {
      optParams(params, 'git.init');
      return service.init();
    },
  };
}
