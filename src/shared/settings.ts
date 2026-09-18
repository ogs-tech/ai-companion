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
  adapters: {
    claude: AdapterSettings;
    cursor: AdapterSettings;
  };
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
}

export const WorkspacePaths = [
  'skills',
  'agents',
  '_backups',
] as const;

export type WorkspacePath = (typeof WorkspacePaths)[number];

export function getDefaults(): Settings {
  return {
    adapters: {
      claude: { enabled: true },
      cursor: { enabled: false },
    },
    ui: { theme: 'system' },
    language: 'off',
  };
}
