import { describe, expect, it, vi } from 'vitest';
import { buildMenuTemplate, type MenuDeps, type MenuItemTemplate } from '../../../../src/main/application/desktop/menu-template.js';
import { SHORTCUTS } from '../../../../src/shared/desktop.js';

const deps = (overrides: Partial<MenuDeps> = {}): MenuDeps => ({
  platform: 'darwin',
  appName: 'AI Companion',
  recentWorkspaces: [],
  send: vi.fn(),
  openWorkspace: vi.fn(),
  showAbout: vi.fn(),
  openLogsFolder: vi.fn(),
  ...overrides,
});

const labels = (items: MenuItemTemplate[]): string[] => items.map((i) => i.label ?? '-');
const menu = (template: MenuItemTemplate[], label: string): MenuItemTemplate[] =>
  template.find((m) => m.label === label)?.submenu ?? [];
const flatten = (items: MenuItemTemplate[]): MenuItemTemplate[] => items.flatMap((i) => [i, ...flatten(i.submenu ?? [])]);

describe('buildMenuTemplate', () => {
  it('starts with the app menu on macOS only', () => {
    const mac = buildMenuTemplate(deps());
    expect(labels(mac)).toEqual(['AI Companion', 'Arquivo', 'Editar', 'Exibir', 'Sessões', 'Janela', 'Ajuda']);
    const other = buildMenuTemplate(deps({ platform: 'win32' }));
    expect(labels(other)).toEqual(['Arquivo', 'Editar', 'Exibir', 'Sessões', 'Janela', 'Ajuda']);
  });

  it('puts Configurações under the app menu on macOS and under Arquivo elsewhere', () => {
    const mac = buildMenuTemplate(deps());
    expect(labels(menu(mac, 'AI Companion'))).toContain('Configurações…');
    expect(labels(menu(mac, 'Arquivo')).join()).not.toContain('Configurações');
    const linux = buildMenuTemplate(deps({ platform: 'linux' }));
    expect(labels(menu(linux, 'Arquivo'))).toContain('Configurações');
  });

  it('takes every accelerator from SHORTCUTS and sends the command on click', () => {
    const send = vi.fn();
    const items = flatten(buildMenuTemplate(deps({ send })));
    const save = items.find((i) => i.label === 'Salvar');
    expect(save?.accelerator).toBe(SHORTCUTS.save);
    save?.click?.();
    expect(send).toHaveBeenCalledWith('save');
    const next = items.find((i) => i.label === 'Próximo workspace');
    expect(next?.accelerator).toBe('Ctrl+Shift+]');
  });

  it('shows the Buscar shortcut without registering it, so the editor keeps its own', () => {
    const find = flatten(buildMenuTemplate(deps())).find((i) => i.label === 'Buscar no arquivo');
    expect(find?.accelerator).toBe('CmdOrCtrl+F');
    expect(find?.registerAccelerator).toBe(false);
  });

  it('has no check marks in the Tema submenu', () => {
    const view = menu(buildMenuTemplate(deps()), 'Exibir');
    const theme = view.find((i) => i.label === 'Tema')?.submenu ?? [];
    expect(labels(theme)).toEqual(['Sistema', 'Claro', 'Escuro']);
    expect(theme.every((i) => !('checked' in i) && !('type' in i))).toBe(true);
  });

  it('lists recent workspaces and opens them by id', () => {
    const openWorkspace = vi.fn();
    const template = buildMenuTemplate(deps({ recentWorkspaces: [{ id: 'w1', name: 'acme' }], openWorkspace }));
    const recent = menu(template, 'Arquivo').find((i) => i.label === 'Abrir recente')?.submenu ?? [];
    expect(labels(recent)).toEqual(['acme']);
    recent[0]?.click?.();
    expect(openWorkspace).toHaveBeenCalledWith('w1');
  });

  it('shows a disabled placeholder when there are no recent workspaces', () => {
    const recent = menu(buildMenuTemplate(deps()), 'Arquivo').find((i) => i.label === 'Abrir recente')?.submenu ?? [];
    expect(recent).toEqual([{ label: 'Nenhum workspace recente', enabled: false }]);
  });

  it('puts Sobre in Ajuda only outside macOS, and never offers updates or docs', () => {
    expect(labels(menu(buildMenuTemplate(deps()), 'Ajuda'))).not.toContain('Sobre AI Companion');
    const help = menu(buildMenuTemplate(deps({ platform: 'win32' })), 'Ajuda');
    expect(labels(help)).toContain('Sobre AI Companion');
    const all = labels(flatten(buildMenuTemplate(deps()))).join('|');
    expect(all).not.toMatch(/Documentação|atualizações/);
  });

  it('wires the logs folder and about callbacks', () => {
    const openLogsFolder = vi.fn();
    const showAbout = vi.fn();
    const items = flatten(buildMenuTemplate(deps({ openLogsFolder, showAbout })));
    items.find((i) => i.label === 'Abrir pasta de logs')?.click?.();
    items.find((i) => i.label === 'Sobre AI Companion')?.click?.();
    expect(openLogsFolder).toHaveBeenCalled();
    expect(showAbout).toHaveBeenCalled();
  });
});
