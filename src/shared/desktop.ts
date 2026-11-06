/**
 * Desktop-shell contract shared by main, preload and renderer: the native menu's
 * commands, the single shortcut table, and the main↔renderer channels used for
 * quit confirmation, window title and recovery. See
 * `docs/superpowers/specs/2026-11-05-desktop-basics-design.md`.
 */

/** Everything a native menu item can ask the renderer to do. The menu never mirrors renderer state: a command that does not apply is a no-op there. */
export type MenuCommand =
  | 'open-folder'
  | 'save'
  | 'save-all'
  | 'close-tab'
  | 'close-workspace'
  | 'open-settings'
  | 'find'
  | 'command-palette'
  | 'quick-open'
  | 'command-mode'
  | 'go-to-line'
  | 'search-project'
  | 'reopen-closed-tab'
  | 'toggle-word-wrap'
  | 'view-files'
  | 'view-git'
  | 'view-terminals'
  | 'theme-system'
  | 'theme-light'
  | 'theme-dark'
  | 'new-session'
  | 'go-needs-attention'
  | 'end-session'
  | 'go-home'
  | 'next-workspace'
  | 'show-shortcuts';

export interface MenuCommandEvent {
  command: MenuCommand;
}

/** Sent by the "Abrir recente" submenu; the renderer switches through its dirty-tabs guard. */
export interface OpenWorkspaceEvent {
  workspaceId: string;
}

/** Electron accelerators (`CmdOrCtrl` = ⌘ on macOS, Ctrl elsewhere). The menu is the only place these are registered. */
export const SHORTCUTS: Readonly<Partial<Record<MenuCommand, string>>> = {
  'open-folder': 'CmdOrCtrl+O',
  save: 'CmdOrCtrl+S',
  'save-all': 'Alt+CmdOrCtrl+S',
  'close-tab': 'CmdOrCtrl+W',
  'close-workspace': 'Shift+CmdOrCtrl+W',
  'open-settings': 'CmdOrCtrl+,',
  find: 'CmdOrCtrl+F',
  'command-palette': 'CmdOrCtrl+K',
  'quick-open': 'CmdOrCtrl+P',
  'command-mode': 'Shift+CmdOrCtrl+P',
  'go-to-line': 'CmdOrCtrl+G',
  'search-project': 'Shift+CmdOrCtrl+F',
  'reopen-closed-tab': 'Shift+CmdOrCtrl+T',
  'new-session': 'Shift+CmdOrCtrl+N',
  'go-needs-attention': 'Shift+CmdOrCtrl+J',
  'end-session': 'Shift+CmdOrCtrl+K',
  'go-home': 'Shift+CmdOrCtrl+H',
  'next-workspace': 'Ctrl+Shift+]',
};

/** Pushed main → renderer when a menu item is clicked. Payload: `MenuCommandEvent`. */
export const MENU_COMMAND_CHANNEL = 'desktop:menu-command';
/** Pushed main → renderer for "Abrir recente". Payload: `OpenWorkspaceEvent`. */
export const OPEN_WORKSPACE_CHANNEL = 'desktop:open-workspace';
/** Pushed main → renderer when the user tries to quit or close the window. Payload: `QuitRequestEvent`. The renderer answers with IPC `desktop.respondToQuit`. */
export const QUIT_REQUEST_CHANNEL = 'desktop:quit-request';
/** Pushed main → renderer after a crash/hang forced a reload, so it can show the recovery screen. Payload: `RecoveryEvent`. */
export const RECOVERY_CHANNEL = 'desktop:recovery';

export interface QuitRequestEvent {
  requestId: string;
}

export interface RecoveryEvent {
  /** Technical details (reason, exit code, log path) for the "Copiar detalhes" button. */
  details: string;
}

export interface RespondToQuitParams {
  requestId: string;
  /** true = nothing left to lose or the user chose Salvar/Não salvar; false = the user cancelled. */
  proceed: boolean;
}

export interface SetWindowTitleParams {
  title: string;
  /** macOS: shows the unsaved dot on the close button (`setDocumentEdited`). */
  edited: boolean;
}

export interface ReportErrorParams {
  source: 'renderer';
  message: string;
  stack?: string;
}
