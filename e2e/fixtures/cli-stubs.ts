import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fake channel CLIs, so the Config > Canais journeys do not depend on what the host machine has installed.
 * `ChannelSetupService` probes the real PATH (`--version`, then the sign-in status command), so a directory of
 * shell scripts placed first on PATH is enough to drive every state of the channel setup steps.
 */
export interface CliStub {
  /** `false` leaves the status command failing until `<bin> <login>` runs (the stub's login creates the marker). */
  signedIn: boolean;
  /**
   * Makes the stub a tiny interactive "conversation" when launched as a session (any args beyond the probes):
   * prints `stub-<bin> ready`, then per stdin line writes the same signal lines the real hooks would to
   * `$AI_COMPANION_SIGNAL_FILE` — `working` → `echo: <line>` → `idle`. Two magic lines: `ask` raises a
   * permission prompt, `perm` raises an answerable one (a `permission` signal for `Bash: npm test`, then waits for
   * the app's `<signal file>.decision` like the real hook and echoes `decision: allow|deny`), `/clear` announces a
   * new conversation (`session-start`, `source: clear`).
   */
  interactive?: boolean;
}

const DIRS_APP_ALSO_PROBES = ['/opt/homebrew/bin', '/usr/local/bin'];

/** The app appends these to PATH when probing, so a real CLI there would defeat a "not installed" scenario. */
export function realBinaryOnHost(bin: string): boolean {
  return DIRS_APP_ALSO_PROBES.some((dir) => existsSync(join(dir, bin)));
}

interface StubShape {
  versionArg: string;
  statusArgs: string;
  signedInOutput: string;
  loginArgs: string;
  /** Extra `case` arms (shell) for subcommands a channel's runtime calls before launching the session. */
  extraArms?: string;
}

const SHAPES: Record<string, StubShape> = {
  'cursor-agent': {
    versionArg: '--version',
    statusArgs: 'status',
    signedInOutput: 'Logged in as e2e@example.com',
    loginArgs: 'login',
    // `CURSOR_PROFILE.newConversationId`: the last stdout line is the chat id.
    extraArms: `  "create-chat") uuidgen; exit 0 ;;\n`,
  },
  // Run-only channel: no account, so the status probe always succeeds.
  lms: { versionArg: 'version', statusArgs: 'status', signedInOutput: 'ok', loginArgs: 'login' },
  claude: {
    versionArg: '--version',
    statusArgs: 'auth status',
    signedInOutput: '{ "loggedIn": true }',
    loginArgs: 'auth login',
  },
};

function interactiveLoop(bin: string): string {
  return `F="$AI_COMPANION_SIGNAL_FILE"
emit() { [ -n "$F" ] && printf '%s\\n' "$1" >> "$F"; }
echo "stub-${bin} ready"
# The real CLI writes <home>/.claude/projects/<cwd slug>/<--session-id>.jsonl once a prompt is sent: the cwd, the
# model's usage and a title it generates from the first prompt. Without it the app has no history entry to name the
# session after (its row would stay "Untitled", the tab generic). The title here is just the first prompt, clipped.
SID=""; prev=""; for a in "$@"; do [ "$prev" = "--session-id" ] && SID="$a"; prev="$a"; done
transcript() {
  [ -n "$SID" ] || return 0
  d="$HOME/.claude/projects/$(pwd | tr '/.' '--')"; mkdir -p "$d"
  f="$d/$SID.jsonl"; first=1; [ -f "$f" ] && first=0
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  title=$(printf '%s' "$1" | tr -d '"\\\\' | cut -c1-60)
  [ $first = 1 ] && printf '%s\\n' '{"type":"user","cwd":"'"$(pwd)"'","timestamp":"'"$ts"'"}' >> "$f"
  printf '%s\\n' '{"type":"assistant","timestamp":"'"$ts"'","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":10,"output_tokens":5}}}' >> "$f"
  [ $first = 1 ] && printf '%s\\n' '{"type":"ai-title","aiTitle":"'"$title"'"}' >> "$f"
  return 0
}
while IFS= read -r line; do
  case "$line" in
    ask) emit '{"event":"notification","payload":{"notification_type":"permission_prompt","message":"Allow Bash?"}}' ;;
    perm)
      rm -f "$F.decision"
      emit '{"event":"permission","payload":{"tool_name":"Bash","tool_input":{"command":"npm test"}}}'
      i=0; while [ $i -lt 100 ] && [ ! -f "$F.decision" ]; do sleep 0.1; i=$((i+1)); done
      D=$(cat "$F.decision" 2>/dev/null); rm -f "$F.decision"
      emit '{"event":"working"}'; echo "decision: \${D:-none}"; emit '{"event":"idle"}' ;;
    /clear) emit '{"event":"session-start","payload":{"source":"clear","session_id":"'"$(uuidgen)"'"}}' ;;
    *) emit '{"event":"working"}'; transcript "$line"; echo "echo: $line"; emit '{"event":"idle"}' ;;
  esac
done
exit 0
`;
}

/** Writes one executable per entry into `dir`; `signedIn` is a marker file next to it. Returns nothing — PATH does the rest. */
export function writeCliStubs(dir: string, stubs: Record<string, CliStub>): void {
  mkdirSync(dir, { recursive: true });
  for (const [bin, stub] of Object.entries(stubs)) {
    const shape = SHAPES[bin];
    if (shape === undefined) throw new Error(`no CLI stub shape for "${bin}"`);
    const marker = join(dir, `${bin}.signed-in`);
    if (stub.signedIn) writeFileSync(marker, '');
    const script = `#!/bin/sh
case "$*" in
  "${shape.versionArg}") echo "9.9.9-e2e"; exit 0 ;;
  "${shape.statusArgs}")
    if [ -f "${marker}" ]; then echo '${shape.signedInOutput}'; exit 0; fi
    echo "not signed in"; exit 1 ;;
  "${shape.loginArgs}") touch "${marker}"; echo "signed in (e2e stub)"; exit 0 ;;
${shape.extraArms ?? ''}esac
${stub.interactive ? interactiveLoop(bin) : ''}echo "unexpected args: $*" >&2; exit 2
`;
    const path = join(dir, bin);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }
}
