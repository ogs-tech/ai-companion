import { SHORTCUTS, type MenuCommand } from '../../../shared/desktop.js';

/** Subset of Electron's `MenuItemConstructorOptions` this menu uses, kept electron-free so the layout is unit-testable. */
export type MenuRole =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'togglefullscreen'
  | 'minimize'
  | 'zoom'
  | 'front'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit';

export interface MenuItemTemplate {
  label?: string;
  role?: MenuRole;
  type?: 'separator';
  accelerator?: string;
  registerAccelerator?: boolean;
  enabled?: boolean;
  click?: () => void;
  submenu?: MenuItemTemplate[];
}

export interface RecentWorkspace {
  id: string;
  name: string;
}

export interface MenuDeps {
  platform: NodeJS.Platform;
  appName: string;
  /** Already limited and ordered by the caller (most recent first). */
  recentWorkspaces: readonly RecentWorkspace[];
  send(command: MenuCommand): void;
  openWorkspace(workspaceId: string): void;
  showAbout(): void;
  openLogsFolder(): void;
}

const SEPARATOR: MenuItemTemplate = { type: 'separator' };

export function buildMenuTemplate(deps: MenuDeps): MenuItemTemplate[] {
  const isMac = deps.platform === 'darwin';

  const command = (label: string, id: MenuCommand, extra: Partial<MenuItemTemplate> = {}): MenuItemTemplate => {
    const accelerator = SHORTCUTS[id];
    return {
      label,
      ...(accelerator !== undefined ? { accelerator } : {}),
      click: () => deps.send(id),
      ...extra,
    };
  };

  const recent: MenuItemTemplate[] =
    deps.recentWorkspaces.length === 0
      ? [{ label: 'Nenhum workspace recente', enabled: false }]
      : deps.recentWorkspaces.map((w) => ({ label: w.name, click: () => deps.openWorkspace(w.id) }));

  const appMenu: MenuItemTemplate[] = isMac
    ? [
        {
          label: deps.appName,
          submenu: [
            { label: `Sobre ${deps.appName}`, click: deps.showAbout },
            SEPARATOR,
            command('Configurações…', 'open-settings'),
            SEPARATOR,
            { label: 'Serviços', role: 'services' },
            SEPARATOR,
            { label: `Ocultar ${deps.appName}`, role: 'hide' },
            { label: 'Ocultar outros', role: 'hideOthers' },
            { label: 'Mostrar todos', role: 'unhide' },
            SEPARATOR,
            { label: `Sair de ${deps.appName}`, role: 'quit' },
          ],
        },
      ]
    : [];

  const file: MenuItemTemplate = {
    label: 'Arquivo',
    submenu: [
      command('Abrir pasta…', 'open-folder'),
      { label: 'Abrir recente', submenu: recent },
      SEPARATOR,
      command('Salvar', 'save'),
      command('Salvar tudo', 'save-all'),
      SEPARATOR,
      command('Fechar aba', 'close-tab'),
      command('Reabrir aba fechada', 'reopen-closed-tab'),
      command('Fechar workspace', 'close-workspace'),
      ...(isMac
        ? []
        : [SEPARATOR, command('Configurações', 'open-settings'), SEPARATOR, { label: 'Sair', role: 'quit' as const }]),
    ],
  };

  const edit: MenuItemTemplate = {
    label: 'Editar',
    submenu: [
      // The accelerator stays off the native item so ⌘Z reaches the page: the Explorer undoes file operations with it, and text fields/CodeMirror keep their own undo.
      { label: 'Desfazer', role: 'undo', registerAccelerator: false },
      { label: 'Refazer', role: 'redo' },
      SEPARATOR,
      { label: 'Recortar', role: 'cut' },
      { label: 'Copiar', role: 'copy' },
      { label: 'Colar', role: 'paste' },
      { label: 'Selecionar tudo', role: 'selectAll' },
      SEPARATOR,
      // The editor (CodeMirror) handles its own ⌘F/Ctrl+F; the label shows the shortcut but the menu must not also fire it.
      command('Buscar no arquivo', 'find', { registerAccelerator: false }),
      command('Paleta de comandos', 'command-palette'),
      SEPARATOR,
      command('Abrir arquivo por nome…', 'quick-open'),
      command('Comandos…', 'command-mode'),
      // ⌘G is "find next" inside CodeMirror; the renderer only handles it when an editor tab is active.
      command('Ir para a linha…', 'go-to-line'),
      command('Buscar no projeto', 'search-project'),
    ],
  };

  const view: MenuItemTemplate = {
    label: 'Exibir',
    submenu: [
      command('Painel de arquivos', 'view-files'),
      command('Painel Git', 'view-git'),
      command('Terminais', 'view-terminals'),
      command('Quebra de linha', 'toggle-word-wrap'),
      SEPARATOR,
      {
        label: 'Tema',
        submenu: [
          command('Sistema', 'theme-system'),
          command('Claro', 'theme-light'),
          command('Escuro', 'theme-dark'),
        ],
      },
      SEPARATOR,
      { label: 'Aumentar zoom', role: 'zoomIn' },
      { label: 'Diminuir zoom', role: 'zoomOut' },
      { label: 'Tamanho real', role: 'resetZoom' },
      SEPARATOR,
      { label: 'Tela cheia', role: 'togglefullscreen' },
    ],
  };

  const sessions: MenuItemTemplate = {
    label: 'Sessões',
    submenu: [
      command('Nova sessão', 'new-session'),
      command('Ir para a que precisa de você', 'go-needs-attention'),
      command('Encerrar sessão', 'end-session'),
      SEPARATOR,
      command('Ir para Início', 'go-home'),
      command('Próximo workspace', 'next-workspace'),
    ],
  };

  const windowMenu: MenuItemTemplate = {
    label: 'Janela',
    submenu: isMac
      ? [
          { label: 'Minimizar', role: 'minimize' },
          { label: 'Ampliar', role: 'zoom' },
          SEPARATOR,
          { label: 'Trazer tudo para a frente', role: 'front' },
        ]
      : [{ label: 'Minimizar', role: 'minimize' }],
  };

  const help: MenuItemTemplate = {
    label: 'Ajuda',
    submenu: [
      command('Atalhos de teclado', 'show-shortcuts'),
      { label: 'Abrir pasta de logs', click: deps.openLogsFolder },
      ...(isMac ? [] : [SEPARATOR, { label: `Sobre ${deps.appName}`, click: deps.showAbout }]),
    ],
  };

  return [...appMenu, file, edit, view, sessions, windowMenu, help];
}
