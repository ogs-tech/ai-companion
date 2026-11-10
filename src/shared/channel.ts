/**
 * Harness registry — the single source of truth for which AI harnesses this
 * app integrates with, and what it can do for each of them.
 *
 * A **harness** is the program that turns a language model into an agent that
 * works on your code: it loads the context, exposes the tools, runs the loop
 * (model → tool → result → model) and enforces the permissions. The model
 * thinks; the harness acts. Claude Code is a harness, Cursor is another — both
 * can run the same model underneath and still behave differently, because an
 * agent's behaviour is decided by its harness, not by its model.
 *
 * Something belongs in this registry when all three hold: it runs the agentic
 * loop, it has its own on-disk configuration surface (the files it reads for
 * its instructions, skills and agents), and the user installs it on their own
 * machine. A model, an HTTP API, an MCP server and a web chat are none of
 * those — see `docs/product/harnesses/harness-model.md` for the full rationale.
 *
 * Adding a harness means adding an entry here, an `Adapter` implementation
 * under `src/main/infrastructure/adapters/`, and wiring it in the composition
 * root. Everything downstream of this file (default settings, settings
 * validation, the Settings screen's toggles) derives from the entry.
 */

/**
 * What this app can do for a given harness.
 *
 * - `manage` — this app owns the channel's customization files (skills,
 *   agents, instructions) and materializes them into that channel's own
 *   config surface. Most channels support this; a run-only channel (LM Studio)
 *   has no such surface.
 * - `run` — this app can spawn and observe that harness's own sessions. Only
 *   a harness that exposes its agentic loop as a CLI qualifies: a GUI-only
 *   harness runs its loop inside its own process, out of reach of a PTY.
 *   Claude Code (`claude`) and Cursor (`cursor-agent`) both have one.
 *
 * The asymmetry is part of the domain, not a gap. `manage` is the baseline
 * and where breadth lives; `run` is depth, and most harnesses will never
 * offer it.
 */
export type ChannelCapability = 'manage' | 'run';

export type ChannelId = 'claude' | 'cursor' | 'lmstudio';

/**
 * How the user gets a channel onto their machine and signs in to it. Every command is run verbatim in a visible
 * terminal (the user watches and can type), never silently — see `ChannelSetupService`.
 */
export interface ChannelSetup {
  /** The executable the app looks for (the profile's `bin`). */
  readonly bin: string;
  /** Args that print the version; exit 0 means installed. */
  readonly versionArgs: readonly string[];
  /** `command` runs in the terminal dialog; `download` opens the vendor's page (the app ships the CLI itself). */
  readonly install: { readonly kind: 'command'; readonly command: string } | { readonly kind: 'download'; readonly url: string };
  /**
   * Sign-in, or `null` when the channel has no account (local models). `statusArgs` must exit 0 when signed in
   * and non-zero (or print `signedOutMarker`) when not.
   */
  readonly auth: {
    readonly loginCommand: string;
    readonly statusArgs: readonly string[];
    /** Output that means "not signed in" for a CLI whose status command exits 0 either way. */
    readonly signedInMarker: string;
  } | null;
}

export interface ChannelDescriptor {
  readonly id: ChannelId;
  /** Human-readable name, spelled the way the harness's own vendor spells it. */
  readonly displayName: string;
  readonly capabilities: readonly ChannelCapability[];
  /** Whether a fresh install syncs to this harness without being asked first. */
  readonly defaultEnabled: boolean;
  readonly setup: ChannelSetup;
}

export const CHANNELS: Readonly<Record<ChannelId, ChannelDescriptor>> = {
  claude: {
    id: 'claude',
    displayName: 'Claude',
    capabilities: ['manage', 'run'],
    defaultEnabled: true,
    setup: {
      bin: 'claude',
      versionArgs: ['--version'],
      install: { kind: 'command', command: 'curl -fsSL https://claude.ai/install.sh | bash' },
      auth: { loginCommand: 'claude auth login', statusArgs: ['auth', 'status'], signedInMarker: '"loggedIn": true' },
    },
  },
  cursor: {
    id: 'cursor',
    displayName: 'Cursor',
    capabilities: ['manage', 'run'],
    defaultEnabled: false,
    setup: {
      bin: 'cursor-agent',
      versionArgs: ['--version'],
      install: { kind: 'command', command: 'curl https://cursor.com/install -fsS | bash' },
      auth: { loginCommand: 'cursor-agent login', statusArgs: ['status'], signedInMarker: 'Logged in' },
    },
  },
  // Run-only: `lms` serves and chats with local models but has no skills, agents or instructions on disk to manage,
  // and no account to sign in to. Its CLI ships inside the LM Studio app, so "install" means getting the app.
  lmstudio: {
    id: 'lmstudio',
    displayName: 'LM Studio',
    capabilities: ['run'],
    defaultEnabled: false,
    setup: {
      bin: 'lms',
      versionArgs: ['version'],
      install: { kind: 'download', url: 'https://lmstudio.ai/download' },
      auth: null,
    },
  },
};

/** Every known harness id, in registry order. */
export const CHANNEL_IDS: readonly ChannelId[] = Object.keys(CHANNELS) as ChannelId[];

export const isChannelId = (value: string): value is ChannelId =>
  Object.prototype.hasOwnProperty.call(CHANNELS, value);

export const channelSupports = (id: ChannelId, capability: ChannelCapability): boolean =>
  CHANNELS[id].capabilities.includes(capability);
