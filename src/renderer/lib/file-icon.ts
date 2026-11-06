import { File as FileGlyph, FileCode, FileJson, FileText, Image, type LucideIcon } from 'lucide-react';
import type { Theme } from '@mui/material';

/** The design-system colour roles a file type may borrow. `erro` is never one: it is reserved for errors and Git deletions. */
export type FileTone = 'azul' | 'ambar' | 'slate' | 'verde';

export interface FileIcon {
  glyph: LucideIcon;
  /** `undefined` = the muted default (no tone). */
  tone?: FileTone;
}

const CODE = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'css', 'html', 'sh']);
const DATA = new Set(['json', 'yaml', 'yml', 'toml', 'xml', 'env']);
const DOCS = new Set(['md', 'mdx', 'txt']);
const MEDIA = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico']);

/** The lower-cased extension of a file name; a dotfile such as `.env` is its own extension, no extension gives `''`. */
function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot === -1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Glyph and tone for a file, by category. One function so the tree, Open
 * Editors, tabs, quick open and search results all draw the same icon. The
 * tone never depends on Git state — Git owns the name colour and the badge.
 */
export function fileIconFor(name: string): FileIcon {
  const ext = extensionOf(name);
  if (CODE.has(ext)) return { glyph: FileCode, tone: 'azul' };
  if (DATA.has(ext)) return { glyph: FileJson, tone: 'ambar' };
  if (DOCS.has(ext)) return { glyph: FileText, tone: 'slate' };
  if (MEDIA.has(ext)) return { glyph: Image, tone: 'verde' };
  return { glyph: FileGlyph };
}

/** Resolves a tone to its colour in the active theme (both themes come from `colorRoles`). */
export function toneColor(theme: Theme, tone: FileTone | undefined): string | undefined {
  switch (tone) {
    case 'azul': return theme.palette.info.main;
    case 'ambar': return theme.palette.warning.main;
    case 'verde': return theme.palette.success.main;
    case 'slate': return theme.ogs.slate;
    default: return undefined;
  }
}
