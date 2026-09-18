/** An application the OS offers for a given path, as the renderer's menu sees it. */
export interface ExternalApp {
  /**
   * The application's bundle identifier. Stable across the bundle being moved
   * or renamed, which is why it — not the name, not the path — is what dedupe,
   * the curated ranking and the remembered preference are all keyed on.
   */
  id: string;
  /** Display name as the file manager shows it, already localized by the OS. */
  name: string;
  /** Absolute path to the application bundle — what actually gets launched. */
  path: string;
  /** True for the one handler the OS itself would use for this path. */
  isDefault: boolean;
  /** True for the app remembered from a previous "open with" on this kind of file. */
  isRemembered: boolean;
  /** `data:image/png;base64,…` of the app's own icon; absent when it could not be read. */
  iconDataUrl?: string;
}

export interface OpenWithSuggestions {
  /** The ranked head of the list — what the menu shows without a second click. */
  primary: ExternalApp[];
  /** Everything else that survived filtering, same ranking, behind "Mais apps…". */
  more: ExternalApp[];
}

/** How many suggestions the context menu shows before "Mais apps…". */
export const OPEN_WITH_PRIMARY_LIMIT = 6;

/** What a row in the file tree is, for both ranking and the remembered-choice key. */
export type OpenWithKind = 'file' | 'dir';
