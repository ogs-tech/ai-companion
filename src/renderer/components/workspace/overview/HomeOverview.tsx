import { Box, Button, Stack, Typography } from '@mui/material';
import { Activity, Folder, FolderOpen, Globe, SquareTerminal } from 'lucide-react';
import { Icon } from '../../ds/Icon.js';
import { StatusPill } from '../../ds/StatusPill.js';
import { OverviewCard, OverviewGrid, OverviewLink, OverviewRow, todayFilters } from './OverviewCard.js';
import { recentWorkspaces, useContextNavigation } from '../../../hooks/use-context-navigation.js';
import { useWorkspaces } from '../../../hooks/use-workspaces.js';
import { useSessions } from '../../../hooks/use-sessions.js';
import { useSessionHistoryStats } from '../../../hooks/use-session-history.js';
import { useHealthReport } from '../../../hooks/use-health-report.js';
import { usePersonalInstruction } from '../../../hooks/use-instructions.js';
import { useCustomizationList } from '../../../hooks/use-customization-list.js';
import { useMcpList } from '../../../hooks/use-mcp-list.js';
import { useSettings } from '../../../hooks/use-settings.js';
import { formatCostUsd, formatWhen } from '../../../lib/format-session-history.js';
import { HARNESSES, HARNESS_IDS } from '../../../../shared/harness.js';
import type { SessionSnapshot } from '../../../../shared/session.js';
import type { Severity } from '../../../../shared/health.js';

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, ok: 2 };
const SEVERITY_LABEL: Record<Severity, string> = { ok: 'Tudo certo', warning: 'Atenção', error: 'Erro' };

interface HomeOverviewProps {
  onOpenSession: (session: SessionSnapshot) => void;
  /** Opens the Histórico tab (scope `all`). */
  onOpenHistory: () => void;
  onOpenDiagnostics: () => void;
  onError: (message: string) => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Início's Visão geral: live sessions, recent workspaces, health and what Global holds. */
export function HomeOverview({ onOpenSession, onOpenHistory, onOpenDiagnostics, onError }: HomeOverviewProps): React.ReactElement {
  const { switchTo, openFolder } = useContextNavigation();
  const { data: workspaces } = useWorkspaces();
  const { data: sessions } = useSessions();
  const { data: todayStats } = useSessionHistoryStats({ kind: 'all' }, todayFilters());
  const { data: health } = useHealthReport('personal');
  const { data: personalInstruction } = usePersonalInstruction();
  const { data: skills } = useCustomizationList('skill', 'skill.list');
  const { data: agents } = useCustomizationList('agent', 'agent.list');
  const { data: mcpServers } = useMcpList();
  const { data: settings } = useSettings();

  const live = (sessions ?? []).filter((s) => s.status === 'running');
  const recents = recentWorkspaces(workspaces ?? [], null);
  const problems = (health?.checks ?? [])
    .filter((c) => c.severity !== 'ok')
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, 2);

  const guarded = (action: () => Promise<unknown>): void => {
    action().catch((err: unknown) => onError(errorMessage(err)));
  };

  return (
    <OverviewGrid testId="home-overview">
      <OverviewCard
        testId="overview-card-sessions"
        glyph={SquareTerminal}
        title="Sessões ativas"
        footer={
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <span data-testid="overview-today-spend">Hoje: {formatCostUsd(todayStats?.totalCostUsd ?? 0)}</span>
            <OverviewLink testId="overview-see-history" onClick={onOpenHistory}>ver histórico</OverviewLink>
          </Stack>
        }
      >
        {live.length === 0 ? (
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>Nenhuma sessão rodando.</Typography>
        ) : (
          live.map((s) => (
            <OverviewRow
              key={s.sessionId}
              testId={`overview-session-${s.sessionId}`}
              glyph={SquareTerminal}
              primary={s.label}
              trailing={<StatusPill variant="running" />}
              onClick={() => onOpenSession(s)}
            />
          ))
        )}
      </OverviewCard>

      <OverviewCard testId="overview-card-recents" glyph={Folder} title="Recentes">
        {recents.length === 0 ? (
          <Box>
            <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', mb: 1 }}>Nenhum workspace aberto ainda.</Typography>
            <Button
              size="small"
              variant="outlined"
              data-testid="overview-open-folder"
              startIcon={<Icon glyph={FolderOpen} size={14} />}
              onClick={() => guarded(openFolder)}
            >
              Abrir pasta…
            </Button>
          </Box>
        ) : (
          recents.map((w) => (
            <OverviewRow
              key={w.id}
              testId={`overview-recent-${w.id}`}
              glyph={Folder}
              primary={w.name}
              {...(w.lastOpenedAt ? { secondary: formatWhen(w.lastOpenedAt) } : {})}
              onClick={() => guarded(() => switchTo(w.id))}
            />
          ))
        )}
      </OverviewCard>

      <OverviewCard
        testId="overview-card-health"
        glyph={Activity}
        title="Saúde"
        action={<OverviewLink testId="overview-open-diagnostics" onClick={onOpenDiagnostics}>Abrir Diagnóstico</OverviewLink>}
      >
        {health ? (
          <>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.5 }}>
              <StatusPill variant={health.worst} label={SEVERITY_LABEL[health.worst]} testId="overview-health-worst" />
            </Stack>
            {problems.map((c) => (
              <OverviewRow key={c.id} testId={`overview-health-check-${c.id}`} primary={c.title} {...(c.target ? { secondary: c.target } : {})} />
            ))}
          </>
        ) : (
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>Verificando…</Typography>
        )}
      </OverviewCard>

      <OverviewCard testId="overview-card-global" glyph={Globe} title="Global">
        <OverviewRow
          testId="overview-global-instruction"
          primary="Instruction pessoal"
          trailing={<Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{personalInstruction ? 'configurada' : 'nenhuma'}</Typography>}
        />
        <OverviewRow testId="overview-global-skills" primary="Skills" trailing={<Count n={skills?.length} />} />
        <OverviewRow testId="overview-global-agents" primary="Agents" trailing={<Count n={agents?.length} />} />
        <OverviewRow testId="overview-global-mcp" primary="MCP servers" trailing={<Count n={mcpServers?.length} />} />
        {settings && (
          <Stack direction="row" spacing={1.5} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
            {HARNESS_IDS.map((id) => {
              const enabled = settings.adapters[id]?.enabled ?? false;
              return (
                <Typography
                  key={id}
                  data-testid={`overview-harness-${id}`}
                  data-enabled={enabled}
                  sx={{ fontSize: '0.75rem', color: enabled ? 'text.primary' : 'text.disabled' }}
                >
                  {HARNESSES[id].displayName} {enabled ? '✓' : '—'}
                </Typography>
              );
            })}
          </Stack>
        )}
      </OverviewCard>
    </OverviewGrid>
  );
}

function Count({ n }: { n: number | undefined }): React.ReactElement {
  return <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{n ?? '…'}</Typography>;
}
