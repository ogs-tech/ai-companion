import type { RepoGitPort } from '../ports/repo-git-port.js';
import type { ConventionSourcePort } from '../ports/convention-source-port.js';
import type { CommitMessageGeneratorPort } from '../ports/commit-message-generator-port.js';
import type { Workspace } from '../../../shared/workspace.js';
import type { GitGenerateCommitMessageResult } from '../../../shared/git.js';
import { DomainError } from '../../domain/errors.js';
import { NotARepositoryError } from '../../domain/git-errors.js';
import { detectCommitConvention, type ConventionFile } from './git/commit-convention.js';
import { buildCommitPrompt } from './git/commit-prompt.js';

export const DIFF_MAX_CHARS = 30_000;
const HISTORY_WINDOW = 30;

const MARKDOWN_CANDIDATES = ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md'];
const COMMITLINT_CONFIG = /^(commitlint\.config\..+|\.commitlintrc(\..+)?)$/;

export interface CommitMessageServiceDeps {
  /** `null` at Início, where the method fails `validation` like every `git.*`. */
  activeWorkspace: Pick<Workspace, 'rootPath'> | null;
}

/** Builds the prompt from the staged diff and the project's convention, then asks the generator. */
export class CommitMessageService {
  constructor(
    private readonly git: RepoGitPort,
    private readonly sources: ConventionSourcePort,
    /** Built per call so the CLI runs inside the workspace root it describes. */
    private readonly generatorFor: (root: string) => CommitMessageGeneratorPort,
    private readonly deps: CommitMessageServiceDeps,
  ) {}

  async generate(signal?: AbortSignal): Promise<GitGenerateCommitMessageResult> {
    const workspace = this.deps.activeWorkspace;
    if (workspace === null) throw new DomainError('validation', 'No workspace is open — git needs one');
    const root = workspace.rootPath;
    if (!(await this.git.isRepo(root))) throw new NotARepositoryError(root);

    const stat = await this.git.stagedStat(root);
    if (stat.trim().length === 0) throw new DomainError('validation', 'Nothing staged to describe');

    const [{ diff, truncated }, markdown, config, subjects] = await Promise.all([
      this.git.stagedDiff(root, DIFF_MAX_CHARS),
      this.readMarkdown(root),
      this.readConfig(root),
      this.git.recentSubjects(root, HISTORY_WINDOW),
    ]);
    const convention = detectCommitConvention({ markdown, config, subjects });
    const prompt = buildCommitPrompt({ convention, stat, diff, diffTruncated: truncated });
    return { message: await this.generatorFor(root).generate(prompt, signal) };
  }

  private async readMarkdown(root: string): Promise<ConventionFile[]> {
    const docs = (await this.sources.list(root, 'docs'))
      .filter((name) => /^contributing/i.test(name))
      .map((name) => `docs/${name}`);
    return this.readAll(root, [...MARKDOWN_CANDIDATES, ...docs]);
  }

  private async readConfig(root: string): Promise<ConventionFile[]> {
    const names = (await this.sources.list(root, '')).filter((name) => COMMITLINT_CONFIG.test(name));
    const files = await this.readAll(root, names);
    const pkg = await this.sources.read(root, 'package.json');
    const commitlint = pkg === null ? undefined : parseCommitlintKey(pkg);
    if (commitlint !== undefined) files.push({ path: 'package.json (commitlint)', content: commitlint });
    const template = await this.git.commitTemplate(root);
    if (template !== null && template.trim().length > 0) files.push({ path: 'commit.template', content: template });
    return files;
  }

  private async readAll(root: string, paths: string[]): Promise<ConventionFile[]> {
    const read = await Promise.all(paths.map(async (path) => ({ path, content: await this.sources.read(root, path) })));
    return read.filter((f): f is ConventionFile => f.content !== null);
  }
}

function parseCommitlintKey(packageJson: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(packageJson);
    if (typeof parsed !== 'object' || parsed === null || !('commitlint' in parsed)) return undefined;
    return JSON.stringify((parsed as { commitlint: unknown }).commitlint, null, 2);
  } catch {
    return undefined;
  }
}
