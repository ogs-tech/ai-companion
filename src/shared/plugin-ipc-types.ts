// Mirror of domain types for renderer use (no branded types here — renderers use plain strings)

export type PluginOriginIpc = 'imported' | 'owned';

export type PluginRefIpc =
  | { kind: 'branch'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'sha'; value: string };

export type PluginSourceIpc = {
  kind: 'git';
  url: string;
  ref?: PluginRefIpc;
};

export type PluginPublishInfoIpc = {
  remoteUrl: string;
  visibility: 'public' | 'private';
  lastPublishedSha: string;
  lastPublishedVersion: string;
  lastPublishedAt: string;
};

export type PluginArtifacts = {
  skills: string[];
  agents: string[];
  commands: string[];
  hooks: number;
  mcp: boolean;
  lsp: boolean;
};

export type PluginSummaryIpc = {
  id: string;
  origin: PluginOriginIpc;
  scope: 'personal' | 'project';
  enabled: boolean;
  installedAt: string;
  source?: PluginSourceIpc;
  installedRef?: PluginRefIpc;
  publishInfo?: PluginPublishInfoIpc;
  marketplaceId?: string;
  /** Set when Claude Code's own `/plugin` also installed it: `claude` = only Claude, `both` = app + Claude. */
  installedBy?: 'claude' | 'both';
  version?: string;
};

export type PluginDrift = {
  kind: 'not_in_settings' | 'not_in_registry' | 'not_cached';
  details?: string;
};

export type PluginListItemIpc = PluginSummaryIpc & {
  drift?: PluginDrift;
  installPath?: string;
};

export type PluginDetailIpc = PluginListItemIpc & {
  manifest?: {
    id: string;
    version: string;
    description?: string;
    artifacts: PluginArtifacts;
  };
};

// Marketplace types
export type MarketplacePluginIpc = {
  name: string;
  description: string;
  author?: { name: string };
  category?: string;
  source: unknown;
  homepage?: string;
};

export type MarketplaceManifestIpc = {
  name: string;
  description?: string;
  plugins: MarketplacePluginIpc[];
};

export type MarketplaceDetectResult =
  | { kind: 'marketplace'; manifest: MarketplaceManifestIpc }
  | { kind: 'plugin' };

export type PluginInstallFromMarketplaceRequest = {
  plugin: MarketplacePluginIpc;
  scope: 'personal' | 'project';
};

// Request types
export type PluginImportRequest = {
  url: string;
  ref?: PluginRefIpc;
  scope: 'personal' | 'project';
};

export type PluginCreateOwnedRequest = {
  id: string;
  version: string;
  description?: string;
  scope: 'personal' | 'project';
};

export type PluginPublishRequest = {
  id: string;
  scope: 'personal' | 'project';
  repoName?: string;
  visibility?: 'public' | 'private';
  version: string;
  commitMessage?: string;
};
