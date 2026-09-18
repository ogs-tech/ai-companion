/** One application as the platform reports it, before any filtering or ranking. */
export interface AppCandidate {
  /** Bundle identifier; the platform's stable id for the application. */
  id: string;
  name: string;
  /** Absolute path to the application bundle. */
  path: string;
}

export interface AppQueryResult {
  candidates: AppCandidate[];
  /** Id of the handler the OS would use itself; absent when the OS names none. */
  defaultAppId?: string;
}

/**
 * Launching a path in *another* application, and asking the OS which ones can
 * open it. Distinct from {@link ShellPort}, which is about URLs: this one is
 * about files on disk and the applications registered to handle them, and it
 * is the only place platform-specific application discovery is allowed to live.
 */
export interface AppLauncherPort {
  /**
   * Applications the OS says can open `absolutePath`, in the OS's own order.
   * Returns an empty candidate list — never throws — on a platform where this
   * is not supported, so the caller degrades to "open with the default app".
   */
  listApplicationsFor(absolutePath: string): Promise<AppQueryResult>;
  /**
   * Reads one application bundle's own identity. Used for an application the
   * user picked by hand, which arrives as a path and has to become a bundle id
   * before it can be remembered. `undefined` when the bundle can't be read.
   */
  identify(appPath: string): Promise<AppCandidate | undefined>;
  /** The application's icon as a PNG data URL, or `undefined` when it cannot be read. */
  iconFor(appPath: string): Promise<string | undefined>;
  openWith(absolutePath: string, appPath: string): Promise<void>;
  /** Opens the path in whatever the OS considers its default handler. */
  openDefault(absolutePath: string): Promise<void>;
  /** Reveals the path in the OS file manager, selected rather than opened. */
  reveal(absolutePath: string): Promise<void>;
}
