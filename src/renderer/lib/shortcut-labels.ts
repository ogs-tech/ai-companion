import { SHORTCUTS, type MenuCommand } from '../../shared/desktop.js';

/** Human names for the "Atalhos de teclado" list, in menu order. */
export const SHORTCUT_LABELS: Readonly<Partial<Record<MenuCommand, string>>> = {
  'open-folder': 'Abrir pasta',
  save: 'Salvar',
  'save-all': 'Salvar tudo',
  'close-tab': 'Fechar aba',
  'close-workspace': 'Fechar workspace',
  'open-settings': 'Configurações',
  find: 'Buscar no arquivo',
  'command-palette': 'Paleta de comandos',
  'quick-open': 'Abrir arquivo por nome',
  'command-mode': 'Comandos',
  'go-to-line': 'Ir para a linha',
  'search-project': 'Buscar no projeto',
  'reopen-closed-tab': 'Reabrir aba fechada',
  'new-session': 'Nova sessão',
  'go-needs-attention': 'Ir para a sessão que precisa de você',
  'end-session': 'Encerrar sessão',
  'go-home': 'Ir para Início',
  'next-workspace': 'Próximo workspace',
};

export function isMac(): boolean {
  return navigator.platform.toLowerCase().includes('mac');
}

const MAC_GLYPHS: Record<string, string> = { cmdorctrl: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
const MAC_ORDER = ['ctrl', 'alt', 'shift', 'cmdorctrl'];

/** `Shift+CmdOrCtrl+N` → `⇧⌘N` on macOS, `Shift+Ctrl+N` elsewhere. */
export function formatAccelerator(accelerator: string, mac: boolean = isMac()): string {
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  const modifiers = parts.map((p) => p.toLowerCase());
  if (!mac) return [...modifiers.map((m) => (m === 'cmdorctrl' ? 'Ctrl' : m[0]!.toUpperCase() + m.slice(1))), key].join('+');
  const ordered = MAC_ORDER.filter((m) => modifiers.includes(m)).map((m) => MAC_GLYPHS[m]);
  return `${ordered.join('')}${key}`;
}

/** The shortcut for `command` as shown to the user, or undefined when it has none. */
export function shortcutFor(command: MenuCommand): string | undefined {
  const accelerator = SHORTCUTS[command];
  return accelerator === undefined ? undefined : formatAccelerator(accelerator);
}
