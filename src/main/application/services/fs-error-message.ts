import { DomainError } from '../../domain/errors.js';

const CODE_MESSAGES: Record<string, string> = {
  EACCES: 'Sem permissão para acessar este item. Verifique as permissões da pasta e tente de novo.',
  EPERM: 'O sistema não permitiu esta operação. Verifique as permissões e tente de novo.',
  EBUSY: 'O item está em uso por outro programa. Feche-o e tente de novo.',
  ENOSPC: 'O disco está cheio. Libere espaço e tente de novo.',
  ENAMETOOLONG: 'O nome ou o caminho é longo demais. Use um nome mais curto.',
  ENOENT: 'O item não existe mais. Atualize a árvore e tente de novo.',
  EEXIST: 'Já existe um item com esse nome.',
  ENOTEMPTY: 'A pasta não está vazia.',
};

/** Plain pt-BR text for a failed file operation: our own validation messages pass through, known errno codes are mapped, the rest is generic. */
export function describeFsError(err: unknown): string {
  if (err instanceof DomainError) return err.kind === 'not_found' ? CODE_MESSAGES['ENOENT']! : err.message;
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && CODE_MESSAGES[code] !== undefined) return CODE_MESSAGES[code];
  return 'Algo deu errado ao executar a operação. Tente de novo.';
}
