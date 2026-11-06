export interface NotificationPort {
  /** `onClick` runs when the user clicks the notification (focus the app, open the session). */
  notify(args: { title: string; body: string; onClick?: () => void }): Promise<void>;
}

/** The app icon's badge (macOS Dock); a no-op where unsupported. 0 clears it. */
export interface BadgePort {
  setCount(count: number): void;
}
