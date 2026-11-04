# Persistent Sessions Across Scopes — Design

- **Date:** 2026-11-03
- **Status:** Implemented; pending author's review.
- **Mockup:** `2026-11-03-persistent-sessions-mockups.html` (option A approved).

## Problem
`activate()` (`src/main/index.ts`) killed every session and discarded the whole service graph on each switch between Início and workspaces, so sessions in the live states (`needs-input`, `working`, `idle`) died on navigation.

## Decisions
1. **Only AI sessions persist.** Terminals still end on a switch.
2. **One list, all scopes (mockup A).** Chips and list count every running session; rows from another scope are tagged with its name ("Acme", "Início"). Opening one switches to its scope first, then opens its tab. Ended sessions only show in their own scope.
3. **Lifecycle.** Deleting a workspace or changing its folders ends that workspace's sessions (`killScope`), including background ones; quitting ends all.
4. **Entity-anchored sessions do not persist.** Their id is the entity urn, which two workspaces can share, so they would collide; they end on a switch.

## Architecture
- `SessionService` is created once in `index.ts`; `rebind({entityService, workspacePath, activeWorkspace})` re-points what `spawn`/`stageAttachment`/`adoptConversation` resolve. Running sessions never read it.
- `SessionSnapshot.scopeId: string | null` (workspace id / `null` = Início); entity sessions take the scope open at spawn.
- `EmbeddedBrowserPort.closeManualTabs()` replaces `destroyAll()` on a switch, so a surviving session keeps its browser.
- `SessionService` left `WorkspaceScopedServices`; its runtimes/signals/browser deps left `WorkspaceScopedSharedDeps`.
- Renderer: `liveInScope` no longer filters running sessions; `SessionRow` takes `scopeName`; `WorkspaceScreen.openSessionAnywhere` does the guarded switch. Overviews show only their own scope's sessions.

## Not verified in the running app
Visual rendering of the scope tag, the switch-on-click flow, whether a surviving session's embedded browser view stays hidden while another scope is on screen, and PTY survival across a real switch.
