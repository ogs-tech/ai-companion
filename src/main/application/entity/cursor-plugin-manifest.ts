import type { PersonalInstruction } from '../../../shared/entity.js';
import { brand } from '../../../shared/brand.js';

/**
 * The Cursor rules directory under a Cursor plugin. Rules dropped here are
 * loaded by Cursor at startup and (with `alwaysApply: true`) applied to every
 * conversation — effectively "user rules via filesystem" via the plugin loader.
 */
export const CURSOR_PLUGIN_ID = brand.cursorPluginId;
export const CURSOR_PLUGIN_MANIFEST_SUBPATH = '.cursor-plugin/plugin.json';
export const CURSOR_PLUGIN_RULES_SUBPATH = 'rules';
export const CURSOR_PLUGIN_PERSONAL_RULE_FILE = 'personal-default.mdc';

/**
 * Marker string embedded in the plugin manifest JSON that the FileMaterializer
 * uses to recognise app-owned files. It's a plain JSON key/value that Cursor
 * ignores at load time.
 */
export const CURSOR_PLUGIN_JSON_MARKER = brand.cursorPluginJsonMarker;

/**
 * Marker embedded as a YAML key in the personal-rule `.mdc` frontmatter. Cursor
 * only reads `description`, `globs`, `alwaysApply`; unknown keys are ignored.
 */
export const CURSOR_RULE_MDC_MARKER = brand.cursorRuleMdcMarker;

/**
 * Render the Cursor plugin manifest as JSON. The marker key is intentionally
 * included so the FileMaterializer can identify this file as app-owned across
 * saves and safely overwrite it.
 */
export function renderCursorPluginManifest(): string {
  const manifest = {
    name: CURSOR_PLUGIN_ID,
    version: '1.0.0',
    description: brand.cursorPluginDescription,
    [brand.ownershipKey]: true,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Render the personal instruction as a Cursor `.mdc` rule. `alwaysApply: true`
 * makes Cursor include this rule in every conversation (equivalent to a global
 * User Rule via the filesystem — the workaround the Cursor community uses
 * while native ~/.cursor/rules support is not yet stable).
 */
export function renderCursorPersonalRule(instruction: PersonalInstruction): string {
  const description = escapeYaml(
    instruction.description || `Personal instruction managed by ${brand.managedByPhrase}`,
  );
  const body = instruction.content.endsWith('\n') ? instruction.content : `${instruction.content}\n`;
  return [
    '---',
    `description: ${description}`,
    'alwaysApply: true',
    `${CURSOR_RULE_MDC_MARKER}`,
    '---',
    '',
    body,
  ].join('\n');
}

function escapeYaml(text: string): string {
  // Simple safe quoting: wrap single-line strings that may contain colons or
  // special YAML chars. Multi-line descriptions are truncated to their first
  // line (Cursor's UI only shows the summary anyway).
  const firstLine = text.split('\n')[0] ?? '';
  if (/^[a-zA-Z0-9 _-]+$/.test(firstLine) && firstLine.length < 200) return firstLine;
  return JSON.stringify(firstLine.slice(0, 200));
}
