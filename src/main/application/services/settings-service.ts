import {
  getDefaults,
  type AdapterSettings,
  type Settings,
  type ThemeMode,
  type LanguagePreference,
} from '../../../shared/settings.js';
import {
  HARNESSES,
  HARNESS_IDS,
  isHarnessId,
  type HarnessId,
} from '../../../shared/harness.js';
import type { SettingsRepository } from '../ports/settings-repository.js';
import { DomainError } from '../../domain/errors.js';

const stripLegacyFields = (settings: Settings): Settings => {
  // Drops fields from older on-disk shapes (adapter keys for harnesses no longer in
  // the registry — e.g. the removed `copilot` one — legacy per-adapter `defaultScope`,
  // the retired global `linkedRepos` array) by rebuilding the `adapters` block from
  // HARNESS_IDS, and backfills any harness the settings file predates at that
  // harness's own `defaultEnabled`.
  const adapters = settings.adapters as unknown as Partial<
    Record<HarnessId, Record<string, unknown>>
  >;
  const { linkedRepos: _unused, ...rest } = settings as Settings & { linkedRepos?: unknown };
  void _unused;
  return {
    ...rest,
    adapters: Object.fromEntries(
      HARNESS_IDS.map((id) => {
        const entry = adapters[id];
        const enabled =
          typeof entry?.['enabled'] === 'boolean'
            ? (entry['enabled'] as boolean)
            : HARNESSES[id].defaultEnabled;
        return [id, { enabled }];
      }),
    ) as Record<HarnessId, AdapterSettings>,
  };
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<U>
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const deepMerge = <T extends Record<string, unknown>>(
  base: T,
  patch: DeepPartial<T>,
): T => {
  const result: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      result[key] = deepMerge(
        baseValue,
        patchValue as DeepPartial<Record<string, unknown>>,
      );
    } else {
      result[key] = patchValue;
    }
  }
  return result as T;
};

const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];
const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = [
  'off',
  'mirror',
  'pt-BR',
  'en',
  'es',
];
const SETTINGS_FIELDS: readonly string[] = ['adapters', 'ui', 'language', 'pricing', 'openWith'];

const invalid = (message: string): never => {
  throw new DomainError('validation', message);
};

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!isPlainObject(value)) invalid(message);
  return value as Record<string, unknown>;
};

// Guards that an object is a well-formed `Settings` before it reaches disk. Mirrors
// the `Settings` shape exactly (strict on unknown keys) so neither a buggy renderer
// (settings.save) nor a malformed merge patch can persist garbage into settings.json.
function assertValidSettings(value: unknown): asserts value is Settings {
  const s = asRecord(value, 'Settings must be an object');

  for (const key of Object.keys(s)) {
    if (!SETTINGS_FIELDS.includes(key)) invalid(`Unknown settings field '${key}'`);
  }

  const adapters = asRecord(s['adapters'], "Missing or invalid 'adapters'");
  const adapterKeys = Object.keys(adapters);
  for (const id of HARNESS_IDS) {
    if (!adapterKeys.includes(id)) invalid(`'adapters' must contain the '${id}' adapter`);
  }
  for (const key of adapterKeys) {
    if (!isHarnessId(key)) invalid(`Unknown adapter '${key}'`);
    const entry = asRecord(adapters[key], `'adapters.${key}' must be an object`);
    if (typeof entry['enabled'] !== 'boolean') {
      invalid(`'adapters.${key}.enabled' must be a boolean`);
    }
    if (Object.keys(entry).some((k) => k !== 'enabled')) {
      invalid(`'adapters.${key}' has unexpected fields`);
    }
  }

  const ui = asRecord(s['ui'], "Missing or invalid 'ui'");
  if (!THEME_MODES.includes(ui['theme'] as ThemeMode)) {
    invalid(`'ui.theme' must be one of ${THEME_MODES.join(' | ')}`);
  }

  if (!LANGUAGE_PREFERENCES.includes(s['language'] as LanguagePreference)) {
    invalid(`'language' must be one of ${LANGUAGE_PREFERENCES.join(' | ')}`);
  }

  // Optional, but free-form in its keys (any model id) and strict in its
  // values — a rate that isn't a finite, non-negative pair of numbers would
  // silently produce a nonsense cost rather than an honest blank.
  const pricing = s['pricing'] === undefined ? {} : asRecord(s['pricing'], "Invalid 'pricing'");
  for (const [model, rate] of Object.entries(pricing)) {
    const entry = asRecord(rate, `'pricing.${model}' must be an object`);
    for (const field of ['input', 'output']) {
      const value = entry[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        invalid(`'pricing.${model}.${field}' must be a non-negative number`);
      }
    }
    if (Object.keys(entry).some((k) => k !== 'input' && k !== 'output')) {
      invalid(`'pricing.${model}' has unexpected fields`);
    }
  }

  // Optional, free-form in its keys (any extension) and strict in its values:
  // a non-string here would be handed to the launcher as a bundle id.
  const openWith = s['openWith'] === undefined ? {} : asRecord(s['openWith'], "Invalid 'openWith'");
  for (const [key, appId] of Object.entries(openWith)) {
    if (typeof appId !== 'string' || appId.length === 0) {
      invalid(`'openWith.${key}' must be a non-empty bundle identifier`);
    }
  }
}

export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  async load(): Promise<Settings | null> {
    const loaded = await this.repository.load();
    return loaded === null ? null : stripLegacyFields(loaded);
  }

  async save(settings: Settings): Promise<void> {
    assertValidSettings(settings);
    await this.repository.save(settings);
  }

  async merge(partial: DeepPartial<Settings>): Promise<Settings> {
    if (!isPlainObject(partial)) {
      throw new DomainError('validation', 'Settings patch must be an object');
    }
    const loaded = await this.repository.load();
    const current = loaded === null ? getDefaults() : stripLegacyFields(loaded);
    const next = deepMerge(current as unknown as Record<string, unknown>, partial as DeepPartial<Record<string, unknown>>) as unknown as Settings;
    assertValidSettings(next);
    await this.repository.save(next);
    return next;
  }

  getDefaults(): Settings {
    return getDefaults();
  }
}
