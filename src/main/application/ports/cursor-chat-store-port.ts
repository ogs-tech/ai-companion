/**
 * Reads the message log `cursor-agent` keeps for one chat, at
 * `~/.cursor/chats/<hash>/<chatId>/store.db` (SQLite).
 *
 * Read-only by contract, like the transcript port: this app never writes into
 * the CLI's own directory.
 */
export interface CursorChatStorePort {
  /**
   * Every message of the chat as raw JSON text (`{"role":"assistant",...}`), in
   * the order Cursor wrote them. Never throws: a missing, locked or unreadable
   * store reads as an empty chat, so cost degrades to "unknown" rather than
   * breaking the history list.
   */
  readMessages(chatDir: string): Promise<string[]>;
}
