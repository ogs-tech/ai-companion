import type { EditorView } from '@codemirror/view';

// Module-scoped, same shape as `show-hidden-files-store.ts`: the palette, the
// project-search panel and the menu sit far from the CodeMirror surfaces and
// have no prop path into them. Each mounted editor registers its view; a
// "reveal" request is addressed to a file path and applied by whichever
// editor owns it — immediately, or when it mounts.

export interface RevealTarget {
  /** 1-based. */
  line: number;
  /** 0-based column range of the match to select; the whole line is selected when omitted. */
  start?: number;
  end?: number;
}

interface PendingReveal extends RevealTarget {
  path: string;
}

const views = new Map<string, EditorView>();
let activePath: string | null = null;
let pending: PendingReveal | null = null;

function applyReveal(view: EditorView, target: RevealTarget): void {
  const doc = view.state.doc;
  const line = doc.line(Math.min(Math.max(target.line, 1), doc.lines));
  const from = line.from + Math.min(target.start ?? 0, line.length);
  const to = target.end !== undefined ? line.from + Math.min(target.end, line.length) : target.start !== undefined ? from : line.to;
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  view.focus();
}

/** Called by a mounted editor. Returns the cleanup. A pending reveal addressed to `path` is applied right away. */
export function registerEditorView(path: string, view: EditorView): () => void {
  views.set(path, view);
  if (pending?.path === path) {
    const target = pending;
    pending = null;
    applyReveal(view, target);
  }
  return () => {
    if (views.get(path) === view) views.delete(path);
  };
}

/** The editor in front (the active tab's) — what "go to line" acts on. `null` when the active tab isn't an editor. */
export function setActiveEditorPath(path: string | null): void {
  activePath = path;
}

export function hasActiveEditor(): boolean {
  return activePath !== null && views.has(activePath);
}

/** Opens the line in the editor for `path`; if it isn't mounted yet the request waits for it. */
export function revealInEditor(path: string, target: RevealTarget): void {
  const view = views.get(path);
  if (view) applyReveal(view, target);
  else pending = { path, ...target };
}

/** "Go to line" in the active editor. Returns false when there is no editor to act on. */
export function goToLineInActiveEditor(line: number): boolean {
  if (activePath === null) return false;
  const view = views.get(activePath);
  if (!view) return false;
  applyReveal(view, { line });
  return true;
}

/** Number of lines in the active editor, for the palette's hint. */
export function activeEditorLineCount(): number | null {
  if (activePath === null) return null;
  return views.get(activePath)?.state.doc.lines ?? null;
}
