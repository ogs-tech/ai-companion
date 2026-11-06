import { app, Notification } from 'electron';
import type { BadgePort, NotificationPort } from '../../application/ports/notification-port.js';

export class ElectronNotificationAdapter implements NotificationPort {
  async notify(args: { title: string; body: string; onClick?: () => void }): Promise<void> {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: args.title, body: args.body });
    if (args.onClick) notification.on('click', args.onClick);
    notification.show();
  }
}

export class ElectronBadgeAdapter implements BadgePort {
  setCount(count: number): void {
    // `setBadgeCount` covers the macOS Dock and Linux launchers; elsewhere it returns false.
    app.setBadgeCount(count);
  }
}
