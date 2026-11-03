import type { Entity } from '../../../shared/entity.js';
import { DomainError } from '../../domain/errors.js';
import {
  skillEntitySchema,
  agentEntitySchema,
  instructionEntitySchema,
  mcpEntitySchema,
  hookEntitySchema,
} from '../schemas/entity-schema.js';

export class EntityValidator {
  validate(entity: Entity): void {
    const schema =
      entity.kind === 'skill'
        ? skillEntitySchema
        : entity.kind === 'agent'
          ? agentEntitySchema
          : entity.kind === 'instruction'
            ? instructionEntitySchema
            : entity.kind === 'mcp'
              ? mcpEntitySchema
              : entity.kind === 'hook'
                ? hookEntitySchema
                : null;
    if (schema === null) {
      throw new DomainError('validation', `Unsupported entity kind: ${entity.kind}`);
    }
    const result = schema.safeParse(entity);
    if (!result.success) {
      // key is `errors` (not `issues`) to match the renderer editor's validation toast,
      // which reads `err.details.errors as Array<{ path; message }>`.
      throw new DomainError('validation', 'Entity failed validation', {
        errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
  }
}
