import { HARNESSES, HARNESS_IDS, type HarnessId } from './harness.js';

export type ThemeMode = 'system' | 'light' | 'dark';

export type LanguagePreference = 'off' | 'mirror' | 'pt-BR' | 'en' | 'es';

export interface AdapterSettings {
  enabled: boolean;
}

export interface UiSettings {
  theme: ThemeMode;
}

/** USD per million tokens, for one model. */
export interface ModelRateSettings {
  input: number;
  output: number;
}

export interface Settings {
  /** One entry per known harness — see `harness.ts` for the registry. */
  adapters: Record<HarnessId, AdapterSettings>;
  ui: UiSettings;
  language: LanguagePreference;
  /**
   * Per-model rate overrides, merged over the rates bundled with the release
   * and keyed by model id. Only ever consulted for a transcript old enough
   * not to carry the CLI's own cost, and for a model the bundled table has no
   * rate for — so this is for someone on negotiated rates, or running a model
   * that shipped after this release did.
   *
   * Optional, and absent by default: an empty override map and no override map
   * mean the same thing, and settings.json stays free of a key nobody set.
   */
  pricing?: Record<string, ModelRateSettings>;
  /**
   * The application last chosen through "open with", keyed by what it was
   * chosen for — an extension (`.md`), `dir` for folders, or `file` for names
   * without one — and valued by bundle identifier. Consulted only to float
   * that app to the top of the menu, so a stale id (app uninstalled) simply
   * matches nothing.
   *
   * Optional and absent by default: nobody who never used the feature gets
   * the key written into their settings.json.
   */
  openWith?: Record<string, string>;
}

export const WorkspacePaths = [
  'skills',
  'agents',
  '_backups',
] as const;

export type WorkspacePath = (typeof WorkspacePaths)[number];

/**
 * A fresh `adapters` block, one entry per registered harness at its own
 * `defaultEnabled`. Returns a new object on every call — callers persist it.
 */
export function defaultAdapterSettings(): Record<HarnessId, AdapterSettings> {
  return Object.fromEntries(
    HARNESS_IDS.map((id) => [id, { enabled: HARNESSES[id].defaultEnabled }]),
  ) as Record<HarnessId, AdapterSettings>;
}

export function getDefaults(): Settings {
  return {
    adapters: defaultAdapterSettings(),
    ui: { theme: 'system' },
    language: 'off',
  };
}
