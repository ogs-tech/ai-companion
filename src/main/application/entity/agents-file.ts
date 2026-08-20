import type { Instruction } from '../../../shared/entity.js';
import { brand } from '../../../shared/brand.js';

/** First line of every app-generated file; the ownership signal. Keep verbatim. */
export const GENERATED_FILE_MARKER = brand.generatedFileMarker;

/**
 * Renders an `AGENTS.md` from the global instruction: the marker, a blank line,
 * then the instruction body (frontmatter-free on disk). The trailing newline is
 * normalised so the output is byte-stable for drift detection.
 */
export function renderAgentsFile(instruction: Instruction): string {
  const body = instruction.content.endsWith('\n') ? instruction.content : `${instruction.content}\n`;
  return `${GENERATED_FILE_MARKER}\n\n${body}`;
}
