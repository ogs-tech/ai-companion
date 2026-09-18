import { extname } from 'node:path';

/**
 * How a path is classified for the purpose of *ranking* the applications the
 * OS offered for it. Deliberately coarse: this never decides which apps are
 * shown — Launch Services does — only which of them a developer most likely
 * wants at the top.
 */
export type FileCategory =
  | 'dir'
  | 'code'
  | 'markdown'
  | 'spreadsheet'
  | 'image'
  | 'pdf'
  | 'other';

const EXTENSION_CATEGORIES: ReadonlyMap<string, FileCategory> = new Map([
  ...(
    [
      'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'yaml', 'yml',
      'toml', 'sh', 'bash', 'zsh', 'py', 'rb', 'go', 'rs', 'java', 'kt',
      'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sql', 'css', 'scss',
      'html', 'xml', 'ini',
    ] as const
  ).map((ext) => [ext, 'code'] as const),
  ...(['md', 'markdown', 'mdx', 'mdc'] as const).map((ext) => [ext, 'markdown'] as const),
  ...(['xlsx', 'xls', 'csv', 'tsv', 'numbers', 'ods'] as const).map((ext) => [ext, 'spreadsheet'] as const),
  ...(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'heic', 'bmp', 'tiff', 'ico'] as const).map((ext) => [ext, 'image'] as const),
  ['pdf', 'pdf'],
]);

/**
 * A curated opinion about apps a developer reaches for, used only as a
 * tiebreak. `rank` is global (lower wins) and `categories` gates where the
 * app is opinionated about at all — an app absent from a category falls back
 * to alphabetical order alongside everything else the OS returned, rather
 * than being hidden.
 */
interface CuratedApp {
  rank: number;
  categories: readonly FileCategory[];
}

const CURATED: Readonly<Record<string, CuratedApp>> = {
  // Folders belong to the file manager first — it is also what the OS itself
  // defaults to, so this mostly settles the order *below* the default.
  'com.apple.finder': { rank: 0, categories: ['dir'] },
  'com.microsoft.VSCode': { rank: 1, categories: ['dir', 'code', 'markdown', 'other'] },
  // Cursor — its id is ToDesktop-generated and unreadable without this note.
  'com.todesktop.230313mzl4w4u92': { rank: 2, categories: ['dir', 'code', 'markdown', 'other'] },
  'dev.zed.Zed': { rank: 3, categories: ['dir', 'code', 'markdown', 'other'] },
  'com.sublimetext.4': { rank: 4, categories: ['dir', 'code', 'markdown', 'other'] },
  'com.apple.dt.Xcode': { rank: 5, categories: ['code'] },
  'dev.warp.Warp-Stable': { rank: 6, categories: ['dir'] },
  'com.googlecode.iterm2': { rank: 7, categories: ['dir'] },
  'com.apple.Terminal': { rank: 8, categories: ['dir'] },
  'com.apple.iWork.Numbers': { rank: 9, categories: ['spreadsheet'] },
  'com.microsoft.Excel': { rank: 10, categories: ['spreadsheet'] },
  'com.apple.Preview': { rank: 11, categories: ['image', 'pdf'] },
  'com.apple.TextEdit': { rank: 12, categories: ['markdown', 'other'] },
  'com.google.Chrome': { rank: 13, categories: ['image', 'pdf'] },
};

/** The lowercased extension without its dot, or `''` for a dotfile or an extensionless name. */
function extensionOf(absolutePath: string): string {
  return extname(absolutePath).replace(/^\./, '').toLowerCase();
}

export function categoryFor(absolutePath: string, kind: 'file' | 'dir'): FileCategory {
  if (kind === 'dir') return 'dir';
  return EXTENSION_CATEGORIES.get(extensionOf(absolutePath)) ?? 'other';
}

/**
 * The key the remembered "open with" choice is stored under. Every directory
 * shares one key, every extensionless file shares another, and everything
 * else is keyed by its own extension — choosing Numbers for one `.xlsx` is
 * meant to stick for the next one.
 */
export function preferenceKeyFor(absolutePath: string, kind: 'file' | 'dir'): string {
  if (kind === 'dir') return 'dir';
  const ext = extensionOf(absolutePath);
  return ext === '' ? 'file' : `.${ext}`;
}

/** The curated rank of `appId` for `category`, or `undefined` when the catalog has no opinion. */
export function curatedRank(appId: string, category: FileCategory): number | undefined {
  const entry = CURATED[appId];
  if (!entry || !entry.categories.includes(category)) return undefined;
  return entry.rank;
}
