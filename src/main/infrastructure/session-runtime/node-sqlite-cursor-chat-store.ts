import { join } from 'node:path';
import type { CursorChatStorePort } from '../../application/ports/cursor-chat-store-port.js';

/**
 * Reads `store.db` with the SQLite built into Electron's Node (`node:sqlite`),
 * so no native dependency is added.
 *
 * The `blobs` table mixes JSON messages with binary tree nodes; only rows that
 * start with `{"role":` are messages. They are inserted chronologically, so
 * `rowid` order is conversation order.
 */
export class NodeSqliteCursorChatStore implements CursorChatStorePort {
  async readMessages(chatDir: string): Promise<string[]> {
    try {
      // Loaded lazily: a runtime without `node:sqlite` degrades to "unknown cost".
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(join(chatDir, 'store.db'), { readOnly: true });
      try {
        const rows = db.prepare(`SELECT data FROM blobs WHERE data LIKE '{"role":%' ORDER BY rowid`).all();
        return rows.map((row) => {
          const data = row['data'];
          return typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf8');
        });
      } finally {
        db.close();
      }
    } catch {
      return [];
    }
  }
}
