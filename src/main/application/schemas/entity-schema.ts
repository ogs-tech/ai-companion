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
  scopeId: z.string().optional(),
  metadata,
  source,
});

type SingleScope = 'personal' | 'project' | 'workspace';

const scopeTuple = (kindLabel: string) =>
  z.tuple([z.enum(['personal', 'project', 'workspace'])], {
    message: `${kindLabel} scopes must be exactly ["personal"], ["project"] or ["workspace"]`,
  });

/**
 * Shared by skill/agent/instruction: `scopeId` is required for 'project'/
 * 'workspace' and forbidden for 'personal'. Storage location never depends on
 * scope — only the adapter sync destination does (resolveScopePath).
 */
function requireScopeIdWhenScoped(scope: SingleScope, scopeId: string | undefined, ctx: z.RefinementCtx): void {
  if (scope === 'personal') {
    if (scopeId !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scopeId'], message: 'personal scope must not carry scopeId' });
    }
    return;
  }
  if (typeof scopeId !== 'string' || scopeId.trim() === '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scopeId'], message: `${scope} scope requires a non-empty scopeId` });
  }
}

const skillAgentScopes = scopeTuple('skill/agent');

export const skillEntitySchema = entityBase
  .extend({
    kind: z.literal('skill'),
    description: z.string().min(1).max(1024),
    content: z.string(),
    explicitOnly: z.boolean().optional(),
    scopes: skillAgentScopes,
  })
  .passthrough()
  .superRefine((val, ctx) => requireScopeIdWhenScoped(val.scopes[0], val.scopeId, ctx));

export const agentEntitySchema = entityBase
  .extend({
    kind: z.literal('agent'),
    description: z.string().min(1).max(1024),
    systemPrompt: z.string(),
    scopes: skillAgentScopes,
  })
  .passthrough()
  .superRefine((val, ctx) => requireScopeIdWhenScoped(val.scopes[0], val.scopeId, ctx));

// Instruction: discriminated by scopes[0]. Because Zod's discriminatedUnion
// requires a top-level literal discriminator (and 'scopes' is a tuple, not a
// scalar), we branch via superRefine on the shared shape.
export const instructionEntitySchema = entityBase
  .extend({
    kind: z.literal('instruction'),
    content: z.string(),
    scopes: scopeTuple('instruction'),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    const scope = val.scopes[0];
    if (scope === 'personal' && val.name !== 'default') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'personal instruction name must be "default"',
      });
    }
    if (scope !== 'personal' && val.name === 'default') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'non-personal instruction name cannot be "default" (reserved for personal singleton)',
      });
    }
    requireScopeIdWhenScoped(scope, val.scopeId, ctx);
  });
