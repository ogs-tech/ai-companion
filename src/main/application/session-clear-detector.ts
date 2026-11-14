/**
 * Recognises "the user typed `/clear` and pressed Enter" in the raw bytes sent
 * to a session's PTY, for channels whose CLI exposes no hook for it.
 *
 * It is a heuristic over keystrokes, not a protocol: it tracks one line of
 * printable text, honours backspace and Ctrl+U, and gives up on the line the
 * moment anything it cannot model arrives (an escape sequence — arrows, a
 * bracketed paste, the slash-menu navigation). A missed `/clear` leaves the
 * session as it was; a false positive would end a conversation, so every
 * ambiguity resolves to "not a clear".
 */
export class ClearCommandDetector {
  private line = '';
  private poisoned = false;

  constructor(private readonly commands: ReadonlySet<string>) {}

  /** Feeds one write; `true` when it submitted a line that is exactly one of the commands. */
  feed(data: string): boolean {
    let submitted = false;
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        if (!this.poisoned && this.commands.has(this.line.trim())) submitted = true;
        this.reset();
      } else if (ch === '\x1b') {
        this.poisoned = true;
      } else if (ch === '\x7f' || ch === '\b') {
        this.line = this.line.slice(0, -1);
      } else if (ch === '\x15' || ch === '\x03') {
        this.reset();
      } else if (ch >= ' ') {
        this.line += ch;
      }
    }
    return submitted;
  }

  private reset(): void {
    this.line = '';
    this.poisoned = false;
  }
}

/** Slash commands that start a fresh conversation, per channel that has no hook for it. Claude is covered by its `SessionStart` hook. */
export const CLEAR_COMMANDS: Readonly<Record<string, ReadonlySet<string>>> = {
  // https://cursor.com/docs/cli/reference/slash-commands — `/clear`, with the others as aliases.
  cursor: new Set(['/clear', '/new', '/new-chat', '/newchat']),
};
