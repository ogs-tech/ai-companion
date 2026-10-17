import { DomainError } from './errors.js';

/** The target folder is not itself a repository root. */
export class NotARepositoryError extends DomainError {
  override readonly name = 'NotARepositoryError';
  constructor(root: string) {
    super('not_found', `Not a git repository: ${root}`);
  }
}

/** `index.lock` contention, merge conflicts, non-fast-forward and dirty-tree refusals. */
export class GitConflictError extends DomainError {
  override readonly name: string = 'GitConflictError';
  constructor(message: string, details?: { stderr?: string; files?: string[]; reason?: string }) {
    super('conflict', message, details);
  }
}

/** `git push` refused because the remote has commits the local branch lacks. */
export class GitPushRejectedError extends GitConflictError {
  override readonly name = 'GitPushRejectedError';
  constructor(message: string, details?: { stderr?: string }) {
    super(message, { ...details, reason: 'push_rejected' });
  }
}

/** `git pull --ff-only` on diverged branches: nothing was merged or rebased. */
export class GitNonFastForwardError extends GitConflictError {
  override readonly name = 'GitNonFastForwardError';
  constructor(message: string, details?: { stderr?: string }) {
    super(message, { ...details, reason: 'non_fast_forward' });
  }
}

/** Credential failure from the user's own git auth (SSH agent, keychain, credential helper). */
export class GitAuthError extends DomainError {
  override readonly name = 'GitAuthError';
  constructor(message: string, details?: { stderr?: string }) {
    super('auth', message, details);
  }
}

/** Any other git failure. `message` is `GitNotFound` / `GitTimeout` for those two cases. */
export class GitCommandError extends DomainError {
  override readonly name = 'GitCommandError';
  constructor(message: string, details?: { stderr?: string }) {
    super('io', message, details);
  }
}

/** The remote could not be reached (DNS, connection refused/timed out). */
export class GitNetworkError extends DomainError {
  override readonly name = 'GitNetworkError';
  constructor(message: string, details?: { stderr?: string }) {
    super('io', message, details);
  }
}
