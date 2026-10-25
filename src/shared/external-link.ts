export interface ExternalLinkEvent {
  url: string;
}

/** Push channel main→renderer: a URL the session's CLI opened on its own, to show in the embedded browser. */
export const EXTERNAL_LINK_CHANNEL = 'external-link:open' as const;
