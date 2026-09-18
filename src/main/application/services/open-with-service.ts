import {
  OPEN_WITH_PRIMARY_LIMIT,
  type ExternalApp,
  type OpenWithKind,
  type OpenWithSuggestions,
} from '../../../shared/open-with.js';
import type { AppCandidate, AppLauncherPort } from '../ports/app-launcher-port.js';
import { categoryFor, curatedRank, preferenceKeyFor, type FileCategory } from '../open-with/catalog.js';
import type { SettingsService } from './settings-service.js';

/**
 * Launch Services answers honestly but not usefully: it returns every copy of
 * every registered bundle, including the ones a test runner downloaded into a
 * cache and the ones an editor extension unpacked into a dotfolder. None of
 * those are an application the user thinks they have installed, and launching
 * one is at best surprising.
 */
function isNoise(appPath: string): boolean {
  if (appPath.includes('/Library/Caches/')) return true;
  return appPath
    .split('/')
    .some((segment) => segment.startsWith('.') || segment === 'node_modules');
}

/** Lower wins: where a bundle lives decides which copy of a duplicated id survives. */
function installRank(appPath: string): number {
  if (appPath.startsWith('/Applications/')) return 0;
  if (appPath.startsWith('/System/Applications/')) return 1;
  if (appPath.startsWith('/System/Library/')) return 2;
  // An external volume can be unmounted between listing and launching, so it
  // loses to any local copy — but still beats nothing.
  if (appPath.startsWith('/Volumes/')) return 4;
  return 3;
}

/** One entry per bundle id, keeping whichever copy lives in the most canonical place. */
function dedupeById(candidates: readonly AppCandidate[]): AppCandidate[] {
  const best = new Map<string, AppCandidate>();
  for (const candidate of candidates) {
    const incumbent = best.get(candidate.id);
    if (!incumbent || installRank(candidate.path) < installRank(incumbent.path)) {
      best.set(candidate.id, candidate);
    }
  }
  return [...best.values()];
}

interface RankedApp extends AppCandidate {
  isDefault: boolean;
  isRemembered: boolean;
}

/**
 * The order the menu reads in, most-wanted first:
 *
 * 1. what this user last chose for this kind of file — an explicit decision
 *    beats any heuristic, including the system's own;
 * 2. what the OS would do on a double-click;
 * 3. the curated opinion for this category (see `catalog.ts`);
 * 4. everything else alphabetically, so the tail is at least predictable.
 */
function compareApps(a: RankedApp, b: RankedApp, category: FileCategory): number {
  const byFlag = (flag: (app: RankedApp) => boolean): number =>
    Number(flag(b)) - Number(flag(a));

  const remembered = byFlag((app) => app.isRemembered);
  if (remembered !== 0) return remembered;

  const isDefault = byFlag((app) => app.isDefault);
  if (isDefault !== 0) return isDefault;

  const rankA = curatedRank(a.id, category) ?? Number.MAX_SAFE_INTEGER;
  const rankB = curatedRank(b.id, category) ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;

  return a.name.localeCompare(b.name);
}

/**
 * Turns "which programs can open this?" into a menu worth showing, and opens
 * the one that was picked. Platform knowledge lives entirely behind
 * `AppLauncherPort`; everything here — filtering, dedupe, ranking, the
 * remembered choice — is platform-agnostic policy.
 */
export class OpenWithService {
  constructor(
    private readonly launcher: AppLauncherPort,
    private readonly settings: SettingsService,
  ) {}

  async suggest(absolutePath: string, kind: OpenWithKind): Promise<OpenWithSuggestions> {
    const [{ candidates, defaultAppId }, rememberedId] = await Promise.all([
      this.launcher.listApplicationsFor(absolutePath),
      this.rememberedIdFor(absolutePath, kind),
    ]);

    const category = categoryFor(absolutePath, kind);
    const ranked = dedupeById(candidates.filter((candidate) => !isNoise(candidate.path)))
      .map((candidate) => ({
        ...candidate,
        isDefault: candidate.id === defaultAppId,
        isRemembered: candidate.id === rememberedId,
      }))
      .sort((a, b) => compareApps(a, b, category));

    const apps = await Promise.all(ranked.map((app) => this.withIcon(app)));
    return {
      primary: apps.slice(0, OPEN_WITH_PRIMARY_LIMIT),
      more: apps.slice(OPEN_WITH_PRIMARY_LIMIT),
    };
  }

  /** Launches `app`, then remembers it for the next file of this kind — never the other way round. */
  async open(
    absolutePath: string,
    kind: OpenWithKind,
    app: { id: string; path: string },
  ): Promise<void> {
    await this.launcher.openWith(absolutePath, app.path);
    await this.settings.merge({ openWith: { [preferenceKeyFor(absolutePath, kind)]: app.id } });
  }

  /**
   * Opens an application the user picked from the file picker rather than from
   * the suggestions. The bundle is identified first so the remembered choice
   * is keyed the same way as every other one — a preference stored under a
   * filesystem path could never match a candidate, so when the bundle can't be
   * read the application still opens and nothing is remembered, rather than
   * leaving an entry in settings.json that can only ever be dead weight.
   */
  async openByPath(absolutePath: string, kind: OpenWithKind, appPath: string): Promise<void> {
    const identified = await this.launcher.identify(appPath);
    if (identified === undefined) {
      await this.launcher.openWith(absolutePath, appPath);
      return;
    }
    await this.open(absolutePath, kind, { id: identified.id, path: appPath });
  }

  async openDefault(absolutePath: string): Promise<void> {
    await this.launcher.openDefault(absolutePath);
  }

  async reveal(absolutePath: string): Promise<void> {
    await this.launcher.reveal(absolutePath);
  }

  private async rememberedIdFor(absolutePath: string, kind: OpenWithKind): Promise<string | undefined> {
    const settings = await this.settings.load();
    return settings?.openWith?.[preferenceKeyFor(absolutePath, kind)];
  }

  private async withIcon(app: RankedApp): Promise<ExternalApp> {
    const iconDataUrl = await this.launcher.iconFor(app.path);
    return {
      id: app.id,
      name: app.name,
      path: app.path,
      isDefault: app.isDefault,
      isRemembered: app.isRemembered,
      ...(iconDataUrl !== undefined ? { iconDataUrl } : {}),
    };
  }
}
