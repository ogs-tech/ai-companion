import type { PersonalInstruction } from '../../shared/entity.js';
import { WORKSPACE_SOURCE } from '../../shared/entity.js';

/**
 * Seed content for the single `default` global-instruction slot. The screen
 * offers this as a one-click starting point so the first-run experience is a
 * curated, opinionated profile rather than an empty editor.
 *
 * Keep this in sync with the precedence order documented in the body: the four
 * H2 sections are ordered weakest → strongest, and the lead paragraph states
 * that Safety wins over Engineering defaults wins over How-to-work-with-me.
 */
export const DEFAULT_GI_DESCRIPTION =
  'Personal global instructions distributed to every enabled assistant.';

export const DEFAULT_GI_BODY = `# Global instructions

Personal preferences and conventions that apply across every workspace and every enabled assistant (Claude Code, …).

*When rules in this file conflict, Action safety wins over Engineering defaults wins over How-to-work-with-me.* Safety > correctness > style.

## How to work with me

- Reply concisely. Lead with the answer; skip the preamble.
- When blocked, ask one focused question — don't stack assumptions.
- Process pays its own cost or it gets cut. Don't run ceremony for its own sake.
- The default is the short path. Research → Plan → Implement is the exception, used when the work justifies it (run \`/feature-dev\`).

## Engineering defaults

- Apply TDD where it fits, skip it where it doesn't (see \`superpowers:test-driven-development\` for when it pays off). Don't apply it as dogma.
- Fix at the root cause, not the symptom — see \`superpowers:systematic-debugging\`. Band-aids are allowed under pressure if and only if a tracked follow-up exists.
- Run lint, typecheck, and the relevant test subset (where one exists) before declaring a task done.
- Don't introduce new dependencies without flagging the choice and the alternative.
- Don't refactor opportunistically inside a feature or bug PR — separate concerns get separate PRs (see \`commit-commands:commit-push-pr\`).

## Communication

- Be specific. "This is risky" is not feedback; "this is risky because the lock at \`service.ts:42\` releases before the write completes" is.
- State trade-offs. Every recommendation should name what was given up.
- Surface uncertainty explicitly. "I'm not sure about X" beats a confident wrong answer.

## Action safety

- Local, reversible actions (edits, branches, drafts): act, observe, adjust.
- Hard-to-reverse actions (deploys, migrations, force pushes, sent messages): pause and confirm before doing.
- When in doubt, the cost of asking is low; the cost of an unwanted irreversible action is enormous.
`;

/**
 * Build the create-flow customization for the global-instruction slot,
 * pre-filled with the default template. The schema pins `name` to `default` and
 * `scopes` to `['personal']`; timestamps are stamped server-side on save.
 */
export function defaultGlobalInstruction(): PersonalInstruction {
  return {
    urn: '',
    kind: 'instruction',
    name: 'default',
    description: DEFAULT_GI_DESCRIPTION,
    scopes: ['personal'],
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: WORKSPACE_SOURCE,
    content: DEFAULT_GI_BODY,
  };
}
