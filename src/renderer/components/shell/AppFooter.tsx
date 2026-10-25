import { Box, Link, Tooltip } from '@mui/material';
import { Kicker } from '../ds/Kicker.js';
import { brand } from '../../../shared/brand.js';
import { HARNESSES, HARNESS_IDS } from '../../../shared/harness.js';
import { openManualTab } from '../../lib/browser-tabs-store.js';
import { useAreaNavigation } from '../../hooks/use-area-navigation.js';
import { useSettings } from '../../hooks/use-settings.js';

type HealthSeverity = 'ok' | 'warning' | 'error';

interface AppFooterProps {
  healthSeverity?: HealthSeverity;
}

const SYNC_COLOR: Record<HealthSeverity, 'success.main' | 'warning.main' | 'error.main'> = {
  ok: 'success.main',
  warning: 'warning.main',
  error: 'error.main',
};

const SYNC_LABEL: Record<HealthSeverity, string> = {
  ok: 'sincronizado',
  warning: 'atenção',
  error: 'erro',
};

const SYNC_TOOLTIP: Record<HealthSeverity, string> = {
  ok: 'Tudo sincronizado com Claude Code/Cursor.',
  warning: 'Alguns itens estão desincronizados — ver Diagnóstico.',
  error: 'Falha ao sincronizar — ver Diagnóstico.',
};

/**
 * The global status bar: sync health (click → Diagnóstico), one entry per
 * registered harness showing whether its adapter is enabled, and the company
 * brand line on the right.
 */
export function AppFooter({ healthSeverity }: AppFooterProps): React.ReactElement {
  const navigate = useAreaNavigation();
  const { data: settings } = useSettings();

  return (
    <Box
      component="footer"
      data-testid="app-footer"
      sx={{
        flexShrink: 0,
        height: 22,
        bgcolor: 'background.default',
        px: 1.75,
        display: 'flex',
        alignItems: 'center',
        gap: 1.75,
        fontSize: '0.625rem',
        color: 'text.secondary',
      }}
    >
      {healthSeverity !== undefined && (
        <Tooltip title={SYNC_TOOLTIP[healthSeverity]}>
          <Box
            data-testid="status-pill-sync"
            data-variant={healthSeverity}
            role="button"
            tabIndex={0}
            onClick={() => navigate('diagnostico')}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              if (e.key === ' ') e.preventDefault();
              navigate('diagnostico');
            }}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, cursor: 'pointer', '&:hover': { color: 'text.primary' } }}
          >
            <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: SYNC_COLOR[healthSeverity] }} />
            {SYNC_LABEL[healthSeverity]}
          </Box>
        </Tooltip>
      )}
      {settings &&
        HARNESS_IDS.map((id) => {
          const enabled = settings.adapters[id]?.enabled ?? false;
          return (
            <Box component="span" key={id} data-testid={`status-adapter-${id}`} data-enabled={enabled}>
              {HARNESSES[id].displayName}
              <Box component="span" sx={{ color: enabled ? 'inherit' : 'text.disabled' }}>
                {enabled ? ' ✓' : ' —'}
              </Box>
            </Box>
          );
        })}
      <Box sx={{ ml: 'auto', display: 'flex' }}>
        <Kicker>
          <Link
            href={brand.companyUrl}
            underline="hover"
            color="inherit"
            sx={{ font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}
            onClick={(e) => {
              e.preventDefault();
              void openManualTab(brand.companyUrl);
            }}
          >
            {brand.companyLine}
          </Link>
        </Kicker>
      </Box>
    </Box>
  );
}
