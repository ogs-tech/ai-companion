import type { IpcHandlers } from './dispatcher.js';
import type { GitService } from '../application/services/git-service.js';
import type { CommitMessageService } from '../application/services/commit-message-service.js';
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

/** The optional `folder` selecting which of the workspace's repositories a call targets. */
function folderOf(params: unknown, method: string): string | undefined {
  if (params === undefined || params === null) return undefined;
  const raw = asObject(params, method);
  return raw['folder'] === undefined ? undefined : asString(raw['folder'], 'folder');
}

export function buildGitHandlers(service: GitService, commitMessages: CommitMessageService): IpcHandlers {
  return {
    'git.status': async (params) => {
      optParams(params, 'git.status');
      return service.status(folderOf(params, 'git.status'));
    },
    'git.diff': async (params) => {
      const raw = asObject(params, 'git.diff');
      return service.diff(asString(raw['path'], 'path'), asDiffSource(raw['source']), folderOf(raw, 'git.diff'));
    },
    'git.stage': async (params) => {
      const raw = asObject(params, 'git.stage');
      return service.stage(asStringArray(raw['paths'], 'paths'), folderOf(raw, 'git.stage'));
    },
    'git.unstage': async (params) => {
      const raw = asObject(params, 'git.unstage');
      return service.unstage(asStringArray(raw['paths'], 'paths'), folderOf(raw, 'git.unstage'));
    },
    'git.discard': async (params) => {
      const raw = asObject(params, 'git.discard');
      return service.discard(asStringArray(raw['paths'], 'paths'), folderOf(raw, 'git.discard'));
    },
    'git.commit': async (params) => {
      const raw = asObject(params, 'git.commit');
      return service.commit(
        asRawString(raw['message'], 'message'),
        raw['amend'] === undefined ? false : asBoolean(raw['amend'], 'amend'),
        folderOf(raw, 'git.commit'),
      );
    },
    'git.generateCommitMessage': async (params) => {
      optParams(params, 'git.generateCommitMessage');
      return commitMessages.generate(undefined, folderOf(params, 'git.generateCommitMessage'));
    },
    'git.push': async (params) => {
      optParams(params, 'git.push');
      return service.push(folderOf(params, 'git.push'));
    },
    'git.pull': async (params) => {
      optParams(params, 'git.pull');
      return service.pull(folderOf(params, 'git.pull'));
    },
    'git.fetch': async (params) => {
      optParams(params, 'git.fetch');
      return service.fetch(folderOf(params, 'git.fetch'));
    },
    'git.sync': async (params) => {
      optParams(params, 'git.sync');
      return service.sync(folderOf(params, 'git.sync'));
    },
    'git.init': async (params) => {
      optParams(params, 'git.init');
      return service.init(folderOf(params, 'git.init'));
    },
  };
}
