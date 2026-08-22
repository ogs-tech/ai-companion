/** Builds the meta-prompt sent to the `claude` CLI to draft a personal instruction. */
export function buildPersonalInstructionPrompt(context?: string): string {
  const trimmed = context?.trim();
  return [
    'Write a personal "global instructions" document for a software engineer, in Markdown.',
    'This file is distributed to every AI coding assistant they use (Claude Code, Cursor, …) and applies across all of their projects.',
    'Cover: how they want the assistant to communicate, engineering defaults they expect (testing, code review, dependency choices), and any explicit safety/approval rules for risky or hard-to-reverse actions (deploys, force-pushes, destructive commands).',
    'Output ONLY the Markdown document — no preamble, no explanation, no code fence around the whole thing.',
    trimmed
      ? `Context from the user about how they work:\n${trimmed}`
      : 'The user gave no extra context — write a solid, generally-applicable default.',
  ].join('\n\n');
}
