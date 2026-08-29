export type CodeLanguage = 'markdown' | 'javascript' | 'json' | 'css' | 'html' | 'plain';

const EXT_TO_LANGUAGE: Record<string, CodeLanguage> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'javascript',
  tsx: 'javascript',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
};

/** Maps a file path's extension to the closest CodeMirror language extension; unknown extensions fall back to plain (still editable, just without highlighting). */
export function languageForPath(path: string): CodeLanguage {
  const ext = path.split('.').pop()?.toLowerCase();
  return (ext && EXT_TO_LANGUAGE[ext]) || 'plain';
}
