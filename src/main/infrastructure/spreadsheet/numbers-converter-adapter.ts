import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  SpreadsheetConversionError,
  type ConvertedSpreadsheet,
  type SpreadsheetConverterPort,
} from '../../application/ports/spreadsheet-converter-port.js';

const execFileAsync = promisify(execFile);

/**
 * Numbers can stop answering Apple events indefinitely — a document-recovery
 * prompt, an iCloud sign-in sheet, or the "Where is Numbers?" chooser when the
 * app is missing all block on user input that never comes in this context.
 * Without a deadline the preview would spin forever.
 */
const EXPORT_TIMEOUT_MS = 30_000;

/**
 * Exports a Numbers document to `.xlsx` and reports how many tables it holds.
 *
 * Both paths arrive as `argv` rather than being interpolated into the script
 * text: a filename containing a double quote would otherwise be AppleScript
 * injection, and filenames are attacker-influenced whenever the workspace is.
 *
 * `close ... saving no` is only safe because the caller always points this at a
 * throwaway copy. `open` on a document Numbers already has open returns *that*
 * document, so running this against the user's own file would close the window
 * they are editing and discard their unsaved changes. Copying first removes the
 * hazard structurally; detecting "was it already open?" does not, because the
 * user can open the document between the check and the close.
 */
const EXPORT_SCRIPT = `on run argv
  set srcPath to item 1 of argv
  set dstPath to item 2 of argv
  tell application "Numbers"
    set doc to open ((POSIX file srcPath) as alias)
    set tableCount to 0
    repeat with s in sheets of doc
      set tableCount to tableCount + (count of tables of s)
    end repeat
    export doc to (POSIX file dstPath) as Microsoft Excel
    close doc saving no
  end tell
  return tableCount as string
end run`;

interface ExecFailure {
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stderr?: string;
}

/**
 * Turns an `osascript` rejection into the failure the user needs to hear about.
 * The numbers are Apple event error codes, which osascript prints verbatim —
 * they are matched alongside the prose because the prose is localized.
 */
export function classifyExportFailure(err: unknown): SpreadsheetConversionError {
  const { killed, signal, stderr = '' } = (err ?? {}) as ExecFailure;

  if (killed === true || (signal !== undefined && signal !== null)) {
    return new SpreadsheetConversionError(
      'timed_out',
      'Numbers did not respond — it may be waiting on a dialog. Close any open Numbers prompt and try again.',
    );
  }
  if (stderr.includes('-1743') || /not authori[sz]ed|not permitted/i.test(stderr)) {
    return new SpreadsheetConversionError(
      'permission_denied',
      'Previewing this file needs permission to control Numbers. Grant it under System Settings › Privacy & Security › Automation.',
    );
  }
  // -1728 is the generic "no such object" code, but a missing app is by far its
  // most common cause here, since `tell application "Numbers"` is the first
  // thing the script does.
  if (
    stderr.includes('-10814') ||
    stderr.includes('-1728') ||
    /can[’']?t (get|find) application/i.test(stderr)
  ) {
    return new SpreadsheetConversionError(
      'unavailable',
      'Numbers is required to preview this file, and it could not be found on this Mac.',
    );
  }
  return new SpreadsheetConversionError('failed', 'Could not convert this Numbers document.');
}

/** Drives Numbers itself to read a format only Numbers can read. macOS-only by construction. */
export class NumbersConverterAdapter implements SpreadsheetConverterPort {
  supports(absPath: string): boolean {
    return absPath.toLowerCase().endsWith('.numbers');
  }

  async toXlsx(absPath: string): Promise<ConvertedSpreadsheet> {
    if (process.platform !== 'darwin') {
      throw new SpreadsheetConversionError(
        'unavailable',
        'Numbers is required to preview this file, and it only exists on macOS.',
      );
    }

    const workDir = await fs.mkdtemp(join(tmpdir(), 'numbers-convert-'));
    try {
      // Numbers is handed this copy, never `absPath` — see EXPORT_SCRIPT.
      const sourceCopy = join(workDir, 'source.numbers');
      const target = join(workDir, 'converted.xlsx');
      const scriptPath = join(workDir, 'export.applescript');

      try {
        await fs.copyFile(absPath, sourceCopy);
        await fs.writeFile(scriptPath, EXPORT_SCRIPT, 'utf8');
      } catch {
        throw new SpreadsheetConversionError('failed', 'Could not convert this Numbers document.');
      }

      let stdout: string;
      try {
        ({ stdout } = await execFileAsync('osascript', [scriptPath, sourceCopy, target], {
          timeout: EXPORT_TIMEOUT_MS,
        }));
      } catch (err) {
        throw classifyExportFailure(err);
      }

      const sourceSheetCount = Number.parseInt(stdout.trim(), 10);
      if (!Number.isInteger(sourceSheetCount) || sourceSheetCount < 0) {
        throw new SpreadsheetConversionError('failed', 'Could not convert this Numbers document.');
      }

      let xlsx: Buffer;
      try {
        xlsx = await fs.readFile(target);
      } catch {
        // osascript exited cleanly but wrote nothing — a lossless-export refusal, say.
        throw new SpreadsheetConversionError('failed', 'Numbers did not produce a workbook.');
      }

      return { xlsx, sourceSheetCount };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
