import type { Entity, EntityKind } from './entity.js';

/** A lifecycle verb a customization row can offer. */
export type CustomizationVerb = 'edit' | 'toggle' | 'delete' | 'import' | 'installOver';

export interface CustomizationKindSpec {
  kind: EntityKind;
  /** Tree group label. */
  label: string;
  verbs: readonly CustomizationVerb[];
  editor: 'properties' | 'mcp-dialog' | 'hook-dialog';
}

const ALL_VERBS: readonly CustomizationVerb[] = ['edit', 'toggle', 'delete', 'import', 'installOver'];

/** Every customization kind, in tree-group order. Menus, `+ Novo` and validators derive from this. */
export const CUSTOMIZATION_KINDS: readonly CustomizationKindSpec[] = [
  { kind: 'instruction', label: 'Instruções', verbs: ALL_VERBS, editor: 'properties' },
  { kind: 'skill', label: 'Skills', verbs: ALL_VERBS, editor: 'properties' },
  { kind: 'agent', label: 'Agents', verbs: ALL_VERBS, editor: 'properties' },
  { kind: 'mcp', label: 'MCP', verbs: ALL_VERBS, editor: 'mcp-dialog' },
  { kind: 'hook', label: 'Hooks', verbs: ALL_VERBS, editor: 'hook-dialog' },
];

export function kindSpec(kind: EntityKind): CustomizationKindSpec {
  const spec = CUSTOMIZATION_KINDS.find((k) => k.kind === kind);
  if (spec === undefined) throw new Error(`Unknown customization kind: ${String(kind)}`);
  return spec;
}

/** The verbs one item supports: its kind's, minus `delete` for the personal instruction singleton. */
export function itemVerbs(entity: Pick<Entity, 'kind' | 'name' | 'scopes'>): readonly CustomizationVerb[] {
  const verbs = kindSpec(entity.kind).verbs;
  const personalInstruction = entity.kind === 'instruction' && entity.scopes[0] === 'personal';
  return personalInstruction ? verbs.filter((v) => v !== 'delete') : verbs;
}

export const VERB_LABEL: Record<Exclude<CustomizationVerb, 'toggle'>, string> = {
  edit: 'Editar',
  delete: 'Excluir',
  import: 'Importar',
  installOver: 'Instalar por cima',
};

export function toggleLabel(enabled: boolean): 'Desativar' | 'Ativar' {
  return enabled ? 'Desativar' : 'Ativar';
}
