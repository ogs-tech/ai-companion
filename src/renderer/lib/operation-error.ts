import { IpcCallError } from './ipc.js';

export interface OperationFailure {
  /** "What happened" on the first line, "what to do" after it. pt-BR, never apologetic or vague. */
  message: string;
  /** The raw technical error plus a timestamp, for the "Detalhes" disclosure and "Copiar detalhes". */
  details: string;
}

interface Mapping {
  test: RegExp;
  hint: string;
}

// Order matters: the first match wins. Matched against "<kind> <message>" of the failure.
const MAPPINGS: readonly Mapping[] = [
  { test: /ENOENT|not_found|no such file/i, hint: 'O arquivo não existe mais. Reabra a aba e tente de novo.' },
  { test: /EACCES|EPERM|permission denied|operation not permitted/i, hint: 'Verifique a permissão da pasta e tente de novo.' },
  { test: /ENOSPC|no space left/i, hint: 'O disco está cheio. Libere espaço e tente de novo.' },
  { test: /ETIMEDOUT|timed? ?out|timeout/i, hint: 'A operação demorou demais. Tente de novo.' },
  { test: /ENOTFOUND|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|ECONNRESET|offline|network|failed to fetch/i, hint: 'Sem conexão. Verifique a rede e tente de novo.' },
];

const GENERIC_HINT = 'Algo deu errado. Veja os detalhes e tente de novo.';

/**
 * Turns a failed save/git call into the toast copy: `title` says what failed
 * ("Não foi possível salvar code-review.md"), the mapped hint says what to do.
 * Only the cases above are mapped; everything else gets the generic hint and
 * relies on Detalhes.
 */
export function describeFailure(error: unknown, title: string, now: Date = new Date()): OperationFailure {
  const raw = error instanceof Error ? error.message : String(error);
  const kind = error instanceof IpcCallError ? error.kind : '';
  const hint = MAPPINGS.find((m) => m.test.test(`${kind} ${raw}`))?.hint ?? GENERIC_HINT;
  return {
    message: `${title}\n${hint}`,
    details: `${raw}\n${now.toISOString()}`,
  };
}
