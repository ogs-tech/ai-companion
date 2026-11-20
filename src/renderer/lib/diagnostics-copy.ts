import type { HealthCheck, Severity } from '../../shared/health.js';

/** The only three words a channel's state is ever given, in the matrix, the status bar and its popover. */
export const STATE_LABEL: Record<Severity, string> = {
  ok: 'Conectado',
  warning: 'Em alerta',
  error: 'Com erro',
};

/** "2 em alerta · 1 com erro", or the all-connected sentence. */
export function countsLabel(counts: { error: number; warning: number }): string {
  const parts = [
    ...(counts.warning > 0 ? [`${counts.warning} em alerta`] : []),
    ...(counts.error > 0 ? [`${counts.error} com erro`] : []),
  ];
  return parts.length === 0 ? 'Tudo conectado' : parts.join(' · ');
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** What happened, in plain pt-BR, from the check's structured `cause`; the English `title` only as a last resort. */
export function causeText(check: HealthCheck): string {
  const file = check.target !== undefined ? basename(check.target) : 'o arquivo';
  switch (check.cause) {
    case 'missing':
      if (check.category === 'symlink') return 'O link que o app instalou não está mais no canal.';
      if (check.category === 'merge-entry') return `A entrada que o app escreveu sumiu de ${file}.`;
      return 'O arquivo que o app gerou não está mais no canal.';
    case 'repointed':
      return 'O link foi alterado fora do app e aponta para outro lugar.';
    case 'drifted':
      if (check.category === 'merge-entry') return `A entrada em ${file} foi editada fora do app.`;
      return 'O arquivo foi editado fora do app.';
    case 'unmanaged':
      if (check.category === 'merge-entry') return `Já existe em ${file} uma entrada com esse nome que o app não criou.`;
      return 'Já existe um arquivo seu nesse lugar, então o app não instalou por cima.';
    case 'needs-auth':
      return 'O servidor está instalado, mas pede login antes de funcionar.';
    case 'runtime-failed':
      return 'O servidor não está funcionando: o log dele tem erros.';
    case 'not-loaded':
      return 'Um arquivo do plugin não pôde ser lido, então parte dele não está carregada.';
    case 'plugin-drift':
      return 'As configurações do Claude e o registro de plugins não concordam sobre este plugin.';
    case 'collector-failed':
      return 'Não foi possível verificar esta parte.';
    default:
      return check.title;
  }
}

/**
 * A hint for the causes no button can fix from here; `undefined` when the detail's action covers it. A check
 * without a cause (an older report) keeps its collector's own remediation.
 */
export function causeHint(check: HealthCheck): string | undefined {
  switch (check.cause) {
    case 'unmanaged':
      return check.category === 'merge-entry' ? `Remova ou renomeie a entrada em ${check.target ?? 'o arquivo'} e atualize.` : undefined;
    case 'runtime-failed':
      return 'Veja o log do servidor e reinicie o Claude Code.';
    case 'not-loaded':
      return 'Corrija o frontmatter do arquivo (use aspas em valores com ": " ou "[") ou atualize o plugin.';
    case 'plugin-drift':
      return 'Reinstale o plugin com "claude plugin install" (ou /plugin no Claude), ou remova-o.';
    case undefined:
      return check.remediation;
    default:
      return undefined;
  }
}
