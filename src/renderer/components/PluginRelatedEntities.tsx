import { useMemo, useState } from 'react';
import { Box, ButtonBase, Paper, Stack, Typography } from '@mui/material';
import { CustomizationViewDrawer } from './CustomizationViewDrawer.js';
import { useCustomizationList } from '../hooks/use-customization-list.js';
import type { Entity } from '../../shared/entity.js';
import type { PluginScope } from '../hooks/use-plugins.js';

interface PluginRelatedEntitiesProps {
  pluginId: string;
  scope?: PluginScope;
}

interface Group {
  key: 'skills' | 'agents';
  label: string;
  items: Entity[];
}

function filterByPlugin(items: Entity[] | undefined, pluginId: string): Entity[] {
  return (items ?? []).filter((i) => i.source.kind === 'plugin' && i.source.pluginId === pluginId);
}

export function PluginRelatedEntities({
  pluginId,
  scope = 'personal',
}: PluginRelatedEntitiesProps): React.ReactElement {
  const skills = useCustomizationList('skill', 'skill.list', scope);
  const agents = useCustomizationList('agent', 'agent.list', scope);
  const [viewing, setViewing] = useState<Entity | null>(null);

  const groups = useMemo<Group[]>(
    () => [
      { key: 'skills', label: 'Skills', items: filterByPlugin(skills.data, pluginId) },
      { key: 'agents', label: 'Agents', items: filterByPlugin(agents.data, pluginId) },
    ],
    [skills.data, agents.data, pluginId],
  );

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="plugin-related-entities">
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        Related entities
      </Typography>
      {total === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No related entities
        </Typography>
      ) : (
        <Stack spacing={2}>
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <Box key={g.key} data-testid={`plugin-related-group-${g.key}`}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  {g.label} ({g.items.length})
                </Typography>
                <Stack spacing={0.5}>
                  {g.items.map((item) => (
                    <ButtonBase
                      key={item.urn}
                      onClick={() => setViewing(item)}
                      sx={{ justifyContent: 'flex-start', textAlign: 'left', p: 1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                    >
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {item.name}
                        </Typography>
                        {item.description && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {item.description}
                          </Typography>
                        )}
                      </Box>
                    </ButtonBase>
                  ))}
                </Stack>
              </Box>
            ))}
        </Stack>
      )}
      <CustomizationViewDrawer entity={viewing} onClose={() => setViewing(null)} onEdit={() => setViewing(null)} />
    </Paper>
  );
}
