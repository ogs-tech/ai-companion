import type { DomainError } from '../../domain/errors.js';
import {
  GitAuthError,
  GitCommandError,
  GitConflictError,
  NotARepositoryError,
} from '../../domain/git-errors.js';

/** stderr carried in `details.stderr` is cut to this many characters. */
export const STDERR_LIMIT = 4096;

export function truncateStderr(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed.length > STDERR_LIMIT ? `${trimmed.slice(0, STDERR_LIMIT)}…` : trimmed;
}

const AUTH = [
  /Authentication failed/i,
  /Permission denied \(publickey/i,
  /could not read (Username|Password)/i,
  /terminal prompts disabled/i,
];

const CONFLICT = [
  /index\.lock/,
  /^CONFLICT /m,
  /non-fast-forward/,
  /\[rejected\]/,
  /would be overwritten by (checkout|merge)/,
  /not possible because you have unmerged files/,
];

/** Lists git prints as tab-indented lines under a refusal (e.g. "would be overwritten by checkout:"). */
function indentedFiles(stderr: string): string[] {
  return stderr
    .split('\n')
    .filter((l) => l.startsWith('\t'))
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Maps a failed git invocation's stderr — produced under `LC_ALL=C`, so the
 * wording is stable — to a domain error. Unknown stderr is never swallowed: it
 * becomes a `GitCommandError` carrying the (truncated) stderr.
 */
export function classifyGitError(stderr: string, root: string): DomainError {
  const details = { stderr: truncateStderr(stderr) };
  const firstLine = details.stderr.split('\n')[0] ?? '';

  if (/not a git repository/i.test(stderr)) return new NotARepositoryError(root);
  if (AUTH.some((re) => re.test(stderr)))
    return new GitAuthError(firstLine || 'Authentication failed', details);
  if (CONFLICT.some((re) => re.test(stderr))) {
    const files = indentedFiles(stderr);
    return new GitConflictError(
      firstLine || 'Conflict',
      files.length > 0 ? { ...details, files } : details,
    );
  }
  return new GitCommandError(firstLine || 'git failed', details);
}
