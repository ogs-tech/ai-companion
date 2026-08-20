/** User-visible product identity and technical footprint — compile-time whitelabel config. */

export interface BrandLegacy {
  readonly workspaceDirName: string;
  readonly cursorPluginId: string;
  readonly generatedFileMarker: string;
  readonly cursorPluginJsonMarker: string;
  readonly cursorRuleMdcMarker: string;
}

export interface BrandConfig {
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

export const brand = {
  displayName: 'AI Companion',
  documentTitle: 'AI Companion',
  appName: 'AI Companion',
  devAppName: 'AI Companion Dev',
  notificationPrefix: 'AI Companion',
  fatalErrorTitle: 'AI Companion failed to start',
  companyLine: 'OGS Tech',
  companyUrl: 'https://www.useogs.com/',
  managedByPhrase: 'AI Companion',
  cursorPluginDescription:
    'AI Companion — personal instruction as a Cursor rule. This plugin is managed automatically; edits will be overwritten.',
  starterPackTitle: 'AI Companion · Starter Pack',
  workspaceDirName: '.ai-companion',
  cursorPluginId: 'ai-companion',
  ownershipKey: 'x-ai-companion-managed',
  generatedFileMarker: '<!-- Managed by AI Companion — edits will be overwritten -->',
  cursorPluginJsonMarker: '"x-ai-companion-managed": true',
  cursorRuleMdcMarker: 'x-ai-companion-managed: true',
  legacy: {
    workspaceDirName: '.superset-ai-app',
    cursorPluginId: 'superset-ai',
    generatedFileMarker: '<!-- Managed by Superset AI — edits will be overwritten -->',
    cursorPluginJsonMarker: '"x-superset-ai-managed": true',
    cursorRuleMdcMarker: 'x-superset-ai-managed: true',
  },
} as const satisfies BrandConfig;

/** Notification / dialog title: "AI Companion — …" */
export function productLabel(suffix: string): string {
  return `${brand.notificationPrefix} — ${suffix}`;
}

/** User-facing workspace path hint, e.g. `~/.ai-companion`. */
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
