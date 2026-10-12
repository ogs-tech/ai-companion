export interface DirectoryResolver {
  /**
   * The canonical path of an existing directory — symlinks resolved, trailing
   * separator stripped — or `null` when the path is missing or not a directory.
   */
  realDirectory(path: string): Promise<string | null>;
}
