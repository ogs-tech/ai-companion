import { DomainError } from '../domain/errors.js';
import type { Scope } from '../application/ports/scope.js';
import type { LanguagePreference } from '../../shared/settings.js';
import type { MarketplacePlugin } from '../domain/marketplace-manifest.js';

const SCOPES: readonly Scope[] = ['personal', 'project'];

export function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DomainError('validation', `Missing or invalid '${field}'`);
  }
  return value;
}

/** Like {@link asString}, but accepts an empty string — for fields such as file content where an intentionally-emptied value is valid. */
export function asRawString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new DomainError('validation', `Missing or invalid '${field}'`);
  }
  return value;
}

export function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DomainError('validation', `Invalid '${label}' payload`);
  }
  return value as Record<string, unknown>;
}

export function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new DomainError('validation', `Missing or invalid '${field}'`);
  }
  return value;
}

export function asScope(value: unknown): Scope {
  if (typeof value !== 'string' || !(SCOPES as readonly string[]).includes(value)) {
    throw new DomainError(
      'validation',
      `Missing or invalid 'scope' (must be ${SCOPES.join(' | ')})`,
    );
  }
  return value as Scope;
}

export function optParams(params: unknown, label: string): Record<string, unknown> {
  return params === undefined || params === null ? {} : asObject(params, label);
}

const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ['off', 'mirror', 'pt-BR', 'en', 'es'];

export function asLanguagePreference(value: unknown, field: string): LanguagePreference {
  if (typeof value !== 'string' || !(LANGUAGE_PREFERENCES as readonly string[]).includes(value)) {
    throw new DomainError(
      'validation',
      `Missing or invalid '${field}' (must be ${LANGUAGE_PREFERENCES.join(' | ')})`,
    );
  }
  return value as LanguagePreference;
}

export function asMarketplacePlugin(value: unknown, label: string): MarketplacePlugin {
  const obj = asObject(value, label);
  const src = obj['source'];

  // A bare string source (local path / raw URL) carries no sub-fields to validate.
  if (typeof src !== 'string') {
    const s = asObject(src, `${label}.source`);
    const kind = s['source'];
    if (typeof kind !== 'string' || kind.length === 0) {
      throw new DomainError(
        'validation',
        `Invalid '${label}.source': missing 'source' discriminant`,
      );
    }

    const requireField = (field: string): void => {
      const v = s[field];
      if (typeof v !== 'string' || v.length === 0) {
        throw new DomainError(
          'validation',
          `Invalid '${label}.source' of kind '${kind}': missing '${field}'`,
        );
      }
    };

    if (kind === 'git-subdir') {
      requireField('url');
      requireField('path');
    } else if (kind === 'url' || kind === 'git') {
      requireField('url');
    } else if (kind === 'github') {
      requireField('repo');
    }
  }

  // Boundary check is scoped to the source discriminant fields whose absence
  // crashes cloneMarketplaceSource. name/description are intentionally not
  // validated here (locked decision: don't over-validate optional metadata).
  return obj as MarketplacePlugin;
}
