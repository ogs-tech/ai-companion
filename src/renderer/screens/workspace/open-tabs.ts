import type { PreviewSource } from '../../components/workspace/EditorPanel.js';
import type { WorkspaceAreaTab } from '../../lib/workspace-area-store.js';
import type { Agent, Instruction, Skill } from '../../../shared/entity.js';
import type { GitDiffSource } from '../../../shared/git.js';
import type { PersistedTab } from '../../../shared/open-editors.js';
import type { SessionAnchor } from '../../../shared/session.js';

export type EntityKind = 'skill' | 'agent';

export type OpenTab =
  | { id: string; kind: 'file'; relPath: string; dirty?: boolean }
  // `inherited`: a Global entity opened read-only from a workspace's "Do Global" section.
  | { id: string; kind: EntityKind; entity: Skill | Agent; isCreate: boolean; dirty?: boolean; inherited?: boolean }
  | { id: string; kind: 'instruction'; entity: Instruction; isCreate: boolean; dirty?: boolean; inherited?: boolean }
  | { id: string; kind: 'session'; anchor: SessionAnchor; sessionId: string; label: string }
  | { id: string; kind: 'terminal'; terminalId: string }
  | { id: string; kind: 'preview'; label: string; source: PreviewSource }
  | { id: string; kind: 'history' }
  | { id: string; kind: 'browser'; tabId: string }
  | { id: string; kind: 'git-diff'; path: string; source: GitDiffSource }
  | { id: string; kind: WorkspaceAreaTab };

/** What a restore checks a saved reference against — what still exists right now. */
export interface RestoreContext {
  entitiesByUrn: ReadonlyMap<string, Skill | Agent | Instruction>;
  terminalIds: ReadonlySet<string>;
  sessionIds: ReadonlySet<string>;
  fileExists: (relPath: string) => Promise<boolean>;
}

/** The references worth keeping; see `PersistedTab` for what is deliberately left out. */
export function toPersisted(tabs: readonly OpenTab[]): PersistedTab[] {
  return tabs.flatMap((tab): PersistedTab[] => {
    switch (tab.kind) {
      case 'file':
        return [{ id: tab.id, kind: 'file', relPath: tab.relPath }];
      case 'preview':
        return tab.source.kind === 'file' ? [{ id: tab.id, kind: 'file-preview', relPath: tab.source.path }] : [];
      case 'skill':
      case 'agent':
      case 'instruction':
        return tab.isCreate ? [] : [{ id: tab.id, kind: 'entity', entityKind: tab.kind, urn: tab.entity.urn, inherited: tab.inherited === true }];
      case 'session':
        return [{ id: tab.id, kind: 'session', anchor: tab.anchor, sessionId: tab.sessionId, label: tab.label }];
      case 'terminal':
        return [{ id: tab.id, kind: 'terminal', terminalId: tab.terminalId }];
      case 'git-diff':
        return [{ id: tab.id, kind: 'git-diff', path: tab.path, source: tab.source }];
      case 'history':
        return [{ id: tab.id, kind: 'history' }];
      case 'browser':
        return []; // recovered from the main process by `reconcileBrowserTabs`
      default:
        return [{ id: tab.id, kind: 'area', area: tab.kind }];
    }
  });
}

/** Rebuilds the tabs whose subject still exists, in saved order. Entities come back with their current on-disk content. */
export async function restoreTabs(saved: readonly PersistedTab[], ctx: RestoreContext): Promise<OpenTab[]> {
  const restored = await Promise.all(
    saved.map(async (tab): Promise<OpenTab | null> => {
      switch (tab.kind) {
        case 'file':
          return (await ctx.fileExists(tab.relPath)) ? { id: tab.id, kind: 'file', relPath: tab.relPath } : null;
        case 'file-preview':
          return (await ctx.fileExists(tab.relPath))
            ? { id: tab.id, kind: 'preview', label: tab.relPath.split('/').pop() || tab.relPath, source: { kind: 'file', path: tab.relPath } }
            : null;
        case 'entity': {
          const entity = ctx.entitiesByUrn.get(tab.urn);
          if (entity === undefined) return null;
          const inherited = tab.inherited ? { inherited: true } : {};
          return tab.entityKind === 'instruction'
            ? { id: tab.id, kind: 'instruction', entity: entity as Instruction, isCreate: false, ...inherited }
            : { id: tab.id, kind: tab.entityKind, entity: entity as Skill | Agent, isCreate: false, ...inherited };
        }
        case 'session':
          return ctx.sessionIds.has(tab.sessionId)
            ? { id: tab.id, kind: 'session', anchor: tab.anchor, sessionId: tab.sessionId, label: tab.label }
            : null;
        case 'terminal':
          return ctx.terminalIds.has(tab.terminalId) ? { id: tab.id, kind: 'terminal', terminalId: tab.terminalId } : null;
        case 'git-diff':
          return { id: tab.id, kind: 'git-diff', path: tab.path, source: tab.source };
        case 'history':
          return { id: tab.id, kind: 'history' };
        case 'area':
          return { id: tab.id, kind: tab.area };
      }
    }),
  );
  return restored.filter((tab): tab is OpenTab => tab !== null);
}
