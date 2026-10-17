/** Reads the files a project describes its commit convention in, relative to the workspace root. */
export interface ConventionSourcePort {
  /** File names directly under `dir` (`''` = the root); `[]` when the folder is missing. */
  list(root: string, dir: string): Promise<string[]>;
  /** UTF-8 contents, or `null` when the file is missing or unreadable. */
  read(root: string, relPath: string): Promise<string | null>;
}
