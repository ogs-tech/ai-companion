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
 * those — see `docs/explanation/harness-model.md` for the full rationale.
 *
 * Adding a harness means adding an entry here, an `Adapter` implementation
 * under `src/main/infrastructure/adapters/`, and wiring it in the composition
 * root. Everything downstream of this file (default settings, settings
 * validation, the Settings screen's toggles) derives from the entry.
 */

/**
 * What this app can do for a given harness.
 *
 * - `manage` — this app owns the harness's customization files (skills,
 *   agents, instructions) and materializes them into that harness's own
 *   config surface. Every listed harness supports this; it is the reason it
 *   is listed at all.
 * - `run` — this app can spawn and observe that harness's own sessions. Only
 *   a harness that exposes its agentic loop as a CLI qualifies: a GUI-only
 *   harness runs its loop inside its own process, out of reach of a PTY.
 *
 * The asymmetry is part of the domain, not a gap. `manage` is the baseline
 * and where breadth lives; `run` is depth, and most harnesses will never
 * offer it.
 */
export type HarnessCapability = 'manage' | 'run';

export type HarnessId = 'claude' | 'cursor';

export interface HarnessDescriptor {
  readonly id: HarnessId;
  /** Human-readable name, spelled the way the harness's own vendor spells it. */
  readonly displayName: string;
  readonly capabilities: readonly HarnessCapability[];
  /** Whether a fresh install syncs to this harness without being asked first. */
  readonly defaultEnabled: boolean;
}

export const HARNESSES: Readonly<Record<HarnessId, HarnessDescriptor>> = {
  claude: {
    id: 'claude',
    displayName: 'Claude',
    capabilities: ['manage', 'run'],
    defaultEnabled: true,
  },
  cursor: {
    id: 'cursor',
    displayName: 'Cursor',
    capabilities: ['manage'],
    defaultEnabled: false,
  },
};

/** Every known harness id, in registry order. */
export const HARNESS_IDS: readonly HarnessId[] = Object.keys(HARNESSES) as HarnessId[];

export const isHarnessId = (value: string): value is HarnessId =>
  Object.prototype.hasOwnProperty.call(HARNESSES, value);

export const harnessSupports = (id: HarnessId, capability: HarnessCapability): boolean =>
  HARNESSES[id].capabilities.includes(capability);
