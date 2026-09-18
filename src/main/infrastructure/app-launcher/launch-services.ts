import type { AppCandidate, AppQueryResult } from '../../application/ports/app-launcher-port.js';

/**
 * Asks Launch Services which applications are registered to open a path, via
 * the ObjC bridge in JavaScript for Automation.
 *
 * `osascript` ships with every macOS install, so this needs no Xcode, no
 * compiled helper and no third-party dependency — which is the whole reason
 * this route was chosen over `lsregister -dump` (undocumented, tens of MB of
 * output) or a Swift helper (needs a toolchain the user may not have).
 *
 * The target path arrives as `argv`, never interpolated into the script text:
 * a filename is attacker-influenced whenever the workspace is, and a quote in
 * one would otherwise be script injection. Same reasoning as the Numbers
 * exporter in `numbers-converter-adapter.ts`.
 */
export const LIST_APPLICATIONS_SCRIPT = `
ObjC.import('AppKit');

function run(argv) {
  var target = argv[0];
  var ws = $.NSWorkspace.sharedWorkspace;
  var fm = $.NSFileManager.defaultManager;
  var url = $.NSURL.fileURLWithPath(target);

  function describe(path) {
    var id = null;
    try {
      var bundle = $.NSBundle.bundleWithURL($.NSURL.fileURLWithPath(path));
      id = ObjC.unwrap(bundle.bundleIdentifier) || null;
    } catch (e) {
      id = null;
    }
    var name = path.split('/').pop();
    try {
      name = ObjC.unwrap(fm.displayNameAtPath(path)) || name;
    } catch (e) { /* keep the filename */ }
    return { id: id, name: String(name).replace(/\\.app$/, ''), path: path };
  }

  var candidates = [];
  try {
    var list = ws.URLsForApplicationsToOpenURL(url);
    for (var i = 0; i < list.count; i++) {
      candidates.push(describe(ObjC.unwrap(list.objectAtIndex(i).path)));
    }
  } catch (e) { /* an unregistered type simply has no handlers */ }

  var defaultAppId = null;
  try {
    var def = ws.URLForApplicationToOpenURL(url);
    defaultAppId = describe(ObjC.unwrap(def.path)).id;
  } catch (e) { /* no default handler */ }

  return JSON.stringify({ candidates: candidates, defaultAppId: defaultAppId });
}
`;

/** Reads one bundle's identity, for an application the user picked by hand. */
export const IDENTIFY_APPLICATION_SCRIPT = `
ObjC.import('AppKit');

function run(argv) {
  var path = argv[0];
  var id = null;
  try {
    var bundle = $.NSBundle.bundleWithURL($.NSURL.fileURLWithPath(path));
    id = ObjC.unwrap(bundle.bundleIdentifier) || null;
  } catch (e) {
    id = null;
  }
  var name = path.split('/').pop();
  try {
    name = ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(path)) || name;
  } catch (e) { /* keep the filename */ }
  return JSON.stringify({ id: id, name: String(name).replace(/\\.app$/, ''), path: path });
}
`;

function isCandidate(value: unknown): value is AppCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const { id, name, path } = value as Record<string, unknown>;
  return (
    typeof id === 'string' && id.length > 0 &&
    typeof name === 'string' && name.length > 0 &&
    typeof path === 'string' && path.length > 0
  );
}

/**
 * Reads the script's stdout back into candidates. Every failure mode —
 * no output, an `osascript` error on stdout, an unexpected shape — degrades
 * to "no applications", because an empty "Abrir com" is a far better outcome
 * than a context menu that throws.
 */
export function parseApplicationsOutput(stdout: string): AppQueryResult {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return { candidates: [] };
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { candidates: [] };
  }

  const { candidates: rawCandidates, defaultAppId } = payload as Record<string, unknown>;
  const candidates = Array.isArray(rawCandidates) ? rawCandidates.filter(isCandidate) : [];

  return {
    candidates,
    ...(typeof defaultAppId === 'string' && defaultAppId.length > 0 ? { defaultAppId } : {}),
  };
}

/** Reads back {@link IDENTIFY_APPLICATION_SCRIPT}; `undefined` for anything that isn't a usable bundle. */
export function parseApplicationOutput(stdout: string): AppCandidate | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  return isCandidate(payload) ? payload : undefined;
}
