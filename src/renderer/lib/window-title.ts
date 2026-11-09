import { brand } from '../../shared/brand.js';
import type { ShellStatus } from './shell-status-store.js';

/** The `●` that marks unsaved work in the title (macOS also gets the native dot via `setDocumentEdited`). */
const DIRTY_MARK = '●';

/** Window title rules from the desktop-basics spec, section 4. */
export function composeWindowTitle(status: ShellStatus): string {
  const { workspaceName, tab } = status;
  if (tab === null) return workspaceName ?? `Início — ${brand.displayName}`;
  const label = tab.dirty ? `${tab.title} ${DIRTY_MARK}` : tab.title;
  return `${label} — ${workspaceName ?? 'Início'}`;
}
