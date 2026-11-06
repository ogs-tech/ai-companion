import { useEffect, useRef } from 'react';
import type { MenuCommand } from '../../shared/desktop.js';

type Handler = () => void;

const handlers = new Map<MenuCommand, Set<Handler>>();
let unsubscribe: (() => void) | null = null;

/** Fans the native menu's single push channel out to whoever owns each command. Subscribes to main lazily, once. */
function ensureSubscribed(): void {
  if (unsubscribe !== null) return;
  unsubscribe = window.api.desktop.onMenuCommand((command) => dispatchMenuCommand(command));
}

/** Runs every handler registered for `command`. Menu items that nobody handles in the current screen are simply no-ops. */
export function dispatchMenuCommand(command: MenuCommand): void {
  for (const handler of handlers.get(command) ?? []) handler();
}

export function onMenuCommand(command: MenuCommand, handler: Handler): () => void {
  ensureSubscribed();
  const set = handlers.get(command) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(command, set);
  return () => {
    set.delete(handler);
  };
}

/** Registers `handler` for `command` while the component is mounted; always calls the latest closure. */
export function useMenuCommand(command: MenuCommand, handler: Handler): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => onMenuCommand(command, () => latest.current()), [command]);
}
