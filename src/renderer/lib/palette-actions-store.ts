import type { Agent, Skill } from '../../shared/entity.js';
import type { ChannelId } from '../../shared/channel.js';
import type { SessionOpenTarget } from '../../shared/session.js';

// Module-scoped, same shape as `workspace-area-store.ts`: the command palette
// sits ABOVE WorkspaceScreen, which owns the Workbench tabs and the "start a
// session where the user currently is" logic. The screen registers these
// while mounted; the palette calls them without a prop path in.

export interface PaletteActions {
  /** Brings up an existing session's tab, switching scope first when it lives elsewhere. */
  openSession: (session: SessionOpenTarget) => void;
  /** Opens (or focuses) a Skill's / Agent's editor tab. */
  openEntity: (kind: 'skill' | 'agent', entity: Skill | Agent) => void;
  /** Starts a fresh session where the user is, with `prompt` typed as an unsent draft. */
  startSession: (request: { prompt: string; channel: ChannelId }) => void;
}

let actions: PaletteActions | null = null;

/** Called by `WorkspaceScreen` while mounted; pass `null` on unmount. */
export function registerPaletteActions(next: PaletteActions | null): void {
  actions = next;
}

/** All three are no-ops while WorkspaceScreen isn't mounted. */
export function openSessionFromPalette(session: SessionOpenTarget): void {
  actions?.openSession(session);
}

export function openEntityFromPalette(kind: 'skill' | 'agent', entity: Skill | Agent): void {
  actions?.openEntity(kind, entity);
}

export function startSessionFromPalette(request: { prompt: string; channel: ChannelId }): void {
  actions?.startSession(request);
}
