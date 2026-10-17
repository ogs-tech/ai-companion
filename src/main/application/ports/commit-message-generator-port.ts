/**
 * Turns a fully built prompt into a commit message. The only AI path in the
 * app: the implementation runs the user's own model CLI, never an API.
 *
 * Failures surface as `DomainError`s: `not_found` when the CLI is missing,
 * `io` for a timeout, a non-zero exit or empty output.
 */
export interface CommitMessageGeneratorPort {
  generate(prompt: string, signal?: AbortSignal): Promise<string>;
}
