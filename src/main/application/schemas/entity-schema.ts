import { z } from 'zod';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'name must match ^[a-z0-9][a-z0-9-]*$');
const version = z.string().regex(/^\d+\.\d+\.\d+(-[\w.-]+)?$/, 'version must follow semver');
const scopes = z
  .array(z.enum(['personal', 'project', 'workspace']))
  .min(1, 'scopes must have at least 1 entry')
  .refine((arr) => new Set(arr).size === arr.length, { message: 'scopes must not contain duplicates' });
const metadata = z.object({
  version,
  tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const source = z.object({ kind: z.enum(['workspace', 'plugin']) }).passthrough();

const entityBase = z.object({
  urn: z.string().min(1),
  name: slug,
  description: z.string().max(1024),
  scopes,
  metadata,
  source,
});

// TODO(follow-up): while linkedRepos is being replaced, skill/agent are
// temporarily restricted to `scopes: ['personal']`. When we introduce a
// per-entity repoPath for skill/agent (mirroring ProjectInstruction), lift this
// constraint and let scopes accept `['project']` / `['personal', 'project']`
// again — the shared `scopes` schema above still supports multi-scope arrays.
const skillAgentScopes = z
  .tuple([z.literal('personal')], {
    message: 'skill/agent scopes are temporarily limited to ["personal"]',
  });

export const skillEntitySchema = entityBase
  .extend({
    kind: z.literal('skill'),
    description: z.string().min(1).max(1024),
    content: z.string(),
    explicitOnly: z.boolean().optional(),
    scopes: skillAgentScopes,
  })
  .passthrough();

export const agentEntitySchema = entityBase
  .extend({
    kind: z.literal('agent'),
    description: z.string().min(1).max(1024),
    systemPrompt: z.string(),
    scopes: skillAgentScopes,
  })
  .passthrough();

// Instruction: discriminated by scopes[0]. Because Zod's discriminatedUnion
// requires a top-level literal discriminator (and 'scopes' is a tuple, not a
// scalar), we branch via superRefine on the shared shape.
export const instructionEntitySchema = entityBase
  .extend({
    kind: z.literal('instruction'),
    content: z.string(),
    scopes: z.tuple([z.enum(['personal', 'project', 'workspace'])], {
      message: 'instruction scopes must be exactly ["personal"], ["project"] or ["workspace"]',
    }),
    scopeId: z.string().optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    const scope = val.scopes[0];
    if (scope === 'personal') {
      if (val.name !== 'default') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['name'],
          message: 'personal instruction name must be "default"',
        });
      }
      if (val.scopeId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scopeId'],
          message: 'personal instruction must not carry scopeId',
        });
      }
    } else {
      if (val.name === 'default') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['name'],
          message: 'non-personal instruction name cannot be "default" (reserved for personal singleton)',
        });
      }
      if (typeof val.scopeId !== 'string' || val.scopeId.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scopeId'],
          message: `${scope} instruction requires a non-empty scopeId`,
        });
      }
    }
  });
