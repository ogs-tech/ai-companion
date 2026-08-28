import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useActiveWorkspace } from '../hooks/use-workspaces.js';
import { sessionAnchorKey, type SessionAnchor } from '../../shared/session.js';

export interface OpenSessionTab {
  sessionId: string;
  anchor: SessionAnchor;
  label: string;
}

interface SessionFocusContextValue {
  openTabs: OpenSessionTab[];
  focusedSessionId: string | null;
  expanded: boolean;
  focusSession: (anchor: SessionAnchor, label: string) => void;
  toggleExpanded: () => void;
}

const SessionFocusContext = createContext<SessionFocusContextValue | null>(null);

export function useSessionFocus(): SessionFocusContextValue {
  const ctx = useContext(SessionFocusContext);
  if (!ctx) throw new Error('useSessionFocus must be used within SessionFocusProvider');
  return ctx;
}

/** Tracks which sessions are open in the persistent sessions panel and which one has focus — UI-only state, not mirrored in react-query. */
export function SessionFocusProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [openTabs, setOpenTabs] = useState<OpenSessionTab[]>([]);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { data: activeWorkspace } = useActiveWorkspace();
  const activeWorkspaceId = activeWorkspace?.id;

  // The backend kills every live session and rebuilds SessionService from
  // scratch on workspace.switchTo — stale tabs here would point at
  // sessionIds that no longer exist server-side. Adjusted during render
  // (React's documented pattern for resetting state when a value changes)
  // rather than in an effect, to avoid an extra commit-then-reset render.
  const [resetForWorkspaceId, setResetForWorkspaceId] = useState(activeWorkspaceId);
  if (activeWorkspaceId !== resetForWorkspaceId) {
    // The initial `activeWorkspace` query round-trip resolves undefined ->
    // 'default' just like a real switch would ('default' -> 'other'). Only
    // treat it as a switch (and wipe tabs) once we've already observed a
    // resolved id — otherwise a tab opened before the query settles gets
    // wiped by its own first render.
    const isInitialResolve = resetForWorkspaceId === undefined;
    setResetForWorkspaceId(activeWorkspaceId);
    if (!isInitialResolve) {
      setOpenTabs([]);
      setFocusedSessionId(null);
    }
  }

  const value = useMemo<SessionFocusContextValue>(
    () => ({
      openTabs,
      focusedSessionId,
      expanded,
      focusSession: (anchor, label) => {
        const sessionId = sessionAnchorKey(anchor);
        setOpenTabs((prev) => (prev.some((tab) => tab.sessionId === sessionId) ? prev : [...prev, { sessionId, anchor, label }]));
        setFocusedSessionId(sessionId);
        setExpanded(true);
      },
      toggleExpanded: () => setExpanded((v) => !v),
    }),
    [openTabs, focusedSessionId, expanded],
  );

  return <SessionFocusContext.Provider value={value}>{children}</SessionFocusContext.Provider>;
}
