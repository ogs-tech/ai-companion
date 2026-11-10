import { Bell, Bot, EyeOff, KeyRound, Languages, PencilLine, TriangleAlert, type LucideIcon } from 'lucide-react';
import { HARNESSES, HARNESS_IDS, isHarnessId } from '../../../shared/harness.js';

/** Fixed per page — `harness:<id>`, `sessions`, `editor`, `language`, `github`, `danger`. */
export type ConfigPageId = string;

export interface ConfigPageDef {
  id: ConfigPageId;
  label: string;
  glyph: LucideIcon;
}

export interface ConfigGroupDef {
  id: string;
  label: string;
  pages: readonly ConfigPageDef[];
}

export const HARNESS_PAGE_PREFIX = 'harness:';
export const DEFAULT_CONFIG_PAGE: ConfigPageId = `${HARNESS_PAGE_PREFIX}${HARNESS_IDS[0] ?? 'claude'}`;

export const configTabId = (page: ConfigPageId): string => `config:${page}`;
export const isConfigTabId = (id: string): boolean => id.startsWith('config:');
export const configPageOfTabId = (id: string): ConfigPageId => id.slice('config:'.length);

/** The danger zone only exists in dev builds, same as before. */
const showDanger = (): boolean => window.api?.isDev === true;

/** The Config view's tree. Harness leaves come from the registry, so a new harness gets a page for free. */
export function configGroups(): ConfigGroupDef[] {
  const groups: ConfigGroupDef[] = [
    {
      id: 'harnesses',
      label: 'Harnesses',
      pages: HARNESS_IDS.map((id) => ({ id: `${HARNESS_PAGE_PREFIX}${id}`, label: HARNESSES[id].displayName, glyph: Bot })),
    },
    { id: 'sessions', label: 'Sessões', pages: [{ id: 'sessions', label: 'Sessões', glyph: Bell }] },
    {
      id: 'app',
      label: 'App',
      pages: [
        { id: 'editor', label: 'Editor e Explorer', glyph: PencilLine },
        { id: 'git-ignore', label: 'Git e arquivos gerados', glyph: EyeOff },
        { id: 'language', label: 'Idioma', glyph: Languages },
        { id: 'github', label: 'GitHub', glyph: KeyRound },
      ],
    },
  ];
  if (showDanger()) groups.push({ id: 'maintenance', label: 'Manutenção', pages: [{ id: 'danger', label: 'Zona de perigo', glyph: TriangleAlert }] });
  return groups;
}

/** The page's def, or `undefined` for a stale id (e.g. a restored tab whose harness left the registry, or `danger` outside dev). */
export function findConfigPage(page: ConfigPageId): ConfigPageDef | undefined {
  return configGroups()
    .flatMap((g) => g.pages)
    .find((p) => p.id === page);
}

export const harnessIdOfPage = (page: ConfigPageId): string | null =>
  page.startsWith(HARNESS_PAGE_PREFIX) && isHarnessId(page.slice(HARNESS_PAGE_PREFIX.length)) ? page.slice(HARNESS_PAGE_PREFIX.length) : null;
