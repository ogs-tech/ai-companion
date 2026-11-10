import { Box, Stack } from '@mui/material';
import { channelSupports, CHANNEL_IDS, CHANNELS, type ChannelId } from '../../../shared/channel.js';
import { useEntityHealth } from '../../hooks/use-entity-health.js';
import { useSettings } from '../../hooks/use-settings.js';
import { openDiagnosticsFor } from '../../lib/diagnostics-focus.js';
import type { ChannelProblems } from '../../lib/entity-health.js';
import { ChannelMark } from '../ChannelMark.js';

/** What the marks speak for: one item, or every item of some kinds (`['skill']`, `['hook', 'mcp', 'plugin']`). */
export type ChannelMarksScope = { urn: string } | { kinds: readonly string[] };

/** Items in scope that have a problem on `channel`, as urns — the count a group shows, the item a row opens. */
export function failingUrns(problems: ChannelProblems, scope: ChannelMarksScope, channel: ChannelId): string[] {
  const inScope = (urn: string): boolean =>
    'urn' in scope ? urn === scope.urn : scope.kinds.some((kind) => urn.startsWith(`urn:${kind}:`));
  const failing: string[] = [];
  for (const [urn, channels] of problems) if (inScope(urn) && channels.includes(channel)) failing.push(urn);
  return failing;
}

/** The channels this app manages files for and the user turned on, in registry order. */
export function integratedChannels(adapters: Partial<Record<ChannelId, { enabled: boolean }>> | undefined): ChannelId[] {
  return CHANNEL_IDS.filter((id) => channelSupports(id, 'manage') && adapters?.[id]?.enabled === true);
}

interface ChannelMarksProps {
  scope: ChannelMarksScope;
}

/**
 * Which channels an item (or a group) reaches: one mark per enabled `manage` channel. A bare mark means "in sync";
 * `⚠` beside it means something there is not (the number is how many items, for a group). Disabled channels are
 * left out so the row only speaks about what is actually integrated.
 */
export function ChannelMarks({ scope }: ChannelMarksProps): React.ReactElement | null {
  const { data: settings } = useSettings();
  const problems = useEntityHealth();
  const channels = integratedChannels(settings?.adapters);
  if (channels.length === 0) return null;
  return (
    <Stack direction="row" spacing={0.75} data-testid="channel-marks" sx={{ alignItems: 'center', flexShrink: 0 }}>
      {channels.map((id) => {
        const failing = failingUrns(problems, scope, id);
        const name = CHANNELS[id].displayName;
        if (failing.length === 0) {
          return (
            <Box key={id} component="span" data-testid={`channel-mark-${id}`} data-ok title={`${name}: sincronizado`} sx={{ display: 'inline-flex' }}>
              <ChannelMark harness={id} size={12} />
            </Box>
          );
        }
        const single = 'urn' in scope;
        const label = single ? `Problema em ${name}. Abrir diagnóstico` : `${failing.length} ${failing.length === 1 ? 'item com problema' : 'itens com problema'} em ${name}`;
        const open = (): void => openDiagnosticsFor(failing[0] ?? '');
        return (
          <Box
            key={id}
            component="span"
            data-testid={`channel-mark-${id}`}
            data-problem
            title={label}
            aria-label={label}
            {...(single ? { role: 'button', tabIndex: 0, onClick: (e: React.MouseEvent) => { e.stopPropagation(); open(); }, onKeyDown: (e: React.KeyboardEvent) => { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); e.stopPropagation(); open(); } } : { role: 'img' })}
            sx={(theme) => ({ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: theme.palette.warning.main, fontSize: '0.6875rem', whiteSpace: 'nowrap', cursor: single ? 'pointer' : 'default' })}
          >
            <ChannelMark harness={id} size={12} />
            <span aria-hidden>⚠{single ? '' : ` ${failing.length}`}</span>
          </Box>
        );
      })}
    </Stack>
  );
}
