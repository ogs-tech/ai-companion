/**
 * Converts a spreadsheet the app cannot parse itself into `.xlsx` bytes it can,
 * so a proprietary format reaches the renderer through the same
 * `kind: 'spreadsheet'` preview as a native workbook.
 */

/**
 * Why a conversion could not be produced. The user-facing wording lives on the
 * error's `message` (each converter words it in terms of the tool it drives);
 * this discriminator is what code and tests branch on.
 */
export type SpreadsheetConversionFailure =
  | 'unavailable'
  | 'permission_denied'
  | 'timed_out'
  | 'failed';

export class SpreadsheetConversionError extends Error {
  readonly failure: SpreadsheetConversionFailure;

  /** `message` is shown to the user verbatim as the preview's `reason` — write it for them, not for a log. */
  constructor(failure: SpreadsheetConversionFailure, message: string) {
    super(message);
    this.name = 'SpreadsheetConversionError';
    this.failure = failure;
  }
}

export interface ConvertedSpreadsheet {
  /** The converted workbook, as `.xlsx` bytes. */
  xlsx: Buffer;
  /**
   * How many worksheets the *source* document genuinely has. Converters may
   * fabricate extra ones — Numbers prepends a localized "export summary" sheet
   * to any multi-table document — and comparing this count against the sheets
   * actually parsed identifies them by arithmetic, so the caller never has to
   * recognize fabricated sheets from their (translated) name or content.
   */
  sourceSheetCount: number;
}

export interface SpreadsheetConverterPort {
  /** Whether this converter handles the given file's format. */
  supports(absPath: string): boolean;
  /** Converts the file to `.xlsx`. Throws {@link SpreadsheetConversionError} for every expected failure. */
  toXlsx(absPath: string): Promise<ConvertedSpreadsheet>;
}
