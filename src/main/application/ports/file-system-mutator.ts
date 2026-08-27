export interface FileSystemMutator {
  mkdirRecursive(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
}
