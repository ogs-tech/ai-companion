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
}

const SHAPES: Record<string, StubShape> = {
  'cursor-agent': { versionArg: '--version', statusArgs: 'status', signedInOutput: 'Logged in as e2e@example.com', loginArgs: 'login' },
  claude: { versionArg: '--version', statusArgs: 'auth status', signedInOutput: '{ "loggedIn": true }', loginArgs: 'auth login' },
};

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
esac
echo "unexpected args: $*" >&2; exit 2
`;
    const path = join(dir, bin);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }
}
