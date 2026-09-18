export interface SelectFolderParams {
  defaultPath?: string;
}

export interface SelectFolderResult {
  canceled: boolean;
  path?: string;
}

export interface SelectApplicationResult {
  canceled: boolean;
  /** Absolute path to the chosen application bundle; absent when canceled. */
  path?: string;
}

export interface DialogPort {
  selectFolder(params: SelectFolderParams): Promise<SelectFolderResult>;
  /** Native picker scoped to application bundles, for "open with → choose another app". */
  selectApplication(): Promise<SelectApplicationResult>;
}
