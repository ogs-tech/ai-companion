/** User-visible product identity and technical footprint — compile-time whitelabel config. */

export interface BrandLegacy {
  readonly workspaceDirName: string;
  readonly cursorPluginId: string;
  readonly generatedFileMarker: string;
  readonly cursorPluginJsonMarker: string;
  readonly cursorRuleMdcMarker: string;
}

export interface BrandConfig {
  readonly slug: string;
  readonly envPrefix: string;
  readonly displayName: string;
  readonly documentTitle: string;
  readonly appName: string;
  readonly devAppName: string;
  readonly notificationPrefix: string;
  readonly fatalErrorTitle: string;
  readonly companyLine: string;
  readonly companyUrl: string;
  readonly managedByPhrase: string;
  readonly cursorPluginDescription: string;
  readonly starterPackTitle: string;
  readonly workspaceDirName: string;
  readonly cursorPluginId: string;
  readonly ownershipKey: string;
  readonly generatedFileMarker: string;
  readonly cursorPluginJsonMarker: string;
  readonly cursorRuleMdcMarker: string;
  readonly legacy: BrandLegacy;
}

const slug = 'air-ide';
const envPrefix = 'AIR_IDE';

export const brand = {
  slug,
  envPrefix,
  displayName: 'AIR IDE',
  documentTitle: 'AIR IDE',
  appName: 'AIR IDE',
  devAppName: 'AIR IDE Dev',
  notificationPrefix: 'AIR IDE',
  fatalErrorTitle: 'AIR IDE failed to start',
  companyLine: 'OGS Tech',
  companyUrl: 'https://www.useogs.com/',
  managedByPhrase: 'AIR IDE',
  cursorPluginDescription:
    'AIR IDE — personal instruction as a Cursor rule. This plugin is managed automatically; edits will be overwritten.',
  starterPackTitle: 'AIR IDE · Starter Pack',
  workspaceDirName: `.${slug}`,
  cursorPluginId: slug,
  ownershipKey: `x-${slug}-managed`,
  generatedFileMarker: '<!-- Managed by AIR IDE — edits will be overwritten -->',
  cursorPluginJsonMarker: `"x-${slug}-managed": true`,
  cursorRuleMdcMarker: `x-${slug}-managed: true`,
  legacy: {
    workspaceDirName: '.superset-ai-app',
    cursorPluginId: 'superset-ai',
    generatedFileMarker: '<!-- Managed by Superset AI — edits will be overwritten -->',
    cursorPluginJsonMarker: '"x-superset-ai-managed": true',
    cursorRuleMdcMarker: 'x-superset-ai-managed: true',
  },
} as const satisfies BrandConfig;

/** Notification / dialog title: "AIR IDE — …" */
export function productLabel(suffix: string): string {
  return `${brand.notificationPrefix} — ${suffix}`;
}

/** User-facing workspace path hint, e.g. `~/.air-ide`. */
export function workspacePathHint(): string {
  return `~/${brand.workspaceDirName}`;
}

/** Cursor plugin sync targets shown in the Instructions screen. */
export function cursorPluginSyncPathHints(): readonly string[] {
  return [
    `~/.cursor/plugins/${brand.cursorPluginId}/.cursor-plugin/plugin.json`,
    `~/.cursor/plugins/${brand.cursorPluginId}/rules/personal-default.mdc`,
  ] as const;
}

/** Ownership markers from the previous product identity — recognized during migration. */
export function legacyOwnershipMarkers(): readonly string[] {
  const { legacy } = brand;
  return [
    legacy.generatedFileMarker,
    legacy.cursorPluginJsonMarker,
    legacy.cursorRuleMdcMarker,
  ] as const;
}

/** Env var name in the brand's namespace, e.g. `brandEnv('SIGNAL_FILE')` → `AIR_IDE_SIGNAL_FILE`. */
export function brandEnv(name: string): string {
  return `${brand.envPrefix}_${name}`;
}

/** Renderer storage key in the brand's namespace, e.g. `air-ide.explorer.showHidden`. */
export function brandKey(name: string): string {
  return `${brand.slug}.${name}`;
}
