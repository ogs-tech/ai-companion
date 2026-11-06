import { isMac } from './shortcut-labels.js';

/**
 * Edit › Buscar no arquivo: the native menu shows ⌘F but does not register it
 * (CodeMirror owns that key inside the editor), so a click on the menu item
 * replays the keystroke on the visible editor instead.
 */
export function openEditorFind(): void {
  const editors = Array.from(document.querySelectorAll<HTMLElement>('.cm-content'));
  const visible = editors.find((el) => el.offsetParent !== null) ?? editors[0];
  if (!visible) return;
  visible.focus();
  const mac = isMac();
  visible.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true }));
}
