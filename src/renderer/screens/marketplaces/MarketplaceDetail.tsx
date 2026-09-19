import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { BadgeCheck } from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { openManualTab } from '../../lib/browser-tabs-store.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { PluginInstallPreviewDialog } from './PluginInstallPreviewDialog.js';
import { EntityDataGrid } from '../../components/EntityDataGrid/index.js';
import type {
  CardSlots,
  EntityDef,
} from '../../components/EntityDataGrid/index.js';

interface MarketplacePlugin {
  name: string;
  description: string;
  author?: { name: string };
  category?: string;
  source: unknown;
}

type MarketplaceSource =
  | { kind: 'directory'; path: string }
  | { kind: 'github'; repo: string; cachePath?: string }
  | { kind: 'git'; url: string; ref?: string; cachePath?: string }
  | { kind: 'url'; url: string; cachePath?: string };

interface MarketplaceSummary {
  id: string;
  source: MarketplaceSource;
  manifest?: {
    name: string;
    description?: string;
    plugins: MarketplacePlugin[];
  };
}

interface MarketplaceDetailProps {
  marketplace: MarketplaceSummary;
}

type InstallState = 'idle' | 'loading' | 'done';

const LOCAL_MARKETPLACE_ID = 'local';
const OFFICIAL_REPO = 'anthropics/claude-plugins-official';

function sourceLabel(source: MarketplaceSource): {
  badge: string;
  detail: string;
  href?: string;
} {
  if (source.kind === 'directory') {
    return { badge: 'local', detail: source.path };
  }
  if (source.kind === 'github') {
    return {
      badge: 'github',
      detail: source.repo,
      href: `https://github.com/${source.repo}`,
    };
  }
  if (source.kind === 'git') {
    return { badge: 'git', detail: source.url, href: source.url };
  }
  return { badge: 'url', detail: source.url, href: source.url };
}

function installButtonLabel(state: InstallState | undefined): string {
  if (state === 'done') return 'Instalado';
  if (state === 'loading') return 'Instalando…';
  return 'Instalar';
}

export function MarketplaceDetail({
  marketplace,
}: MarketplaceDetailProps): React.ReactElement {
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [previewPlugin, setPreviewPlugin] = useState<MarketplacePlugin | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const installed = await callIpc<Array<{ id: string }>>('plugin.list', {
          scope: 'personal',
        });
        if (cancelled) return;
        const installedIds = new Set(installed.map((p) => p.id));
        setInstallStates((prev) => {
          const next: Record<string, InstallState> = { ...prev };
          for (const plugin of marketplace.manifest?.plugins ?? []) {
            if (installedIds.has(plugin.name) && next[plugin.name] !== 'loading') {
              next[plugin.name] = 'done';
            }
          }
          return next;
        });
      } catch {
        // best-effort: leave install states untouched if the lookup fails
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marketplace]);

  const handleInstall = async (plugin: MarketplacePlugin): Promise<void> => {
    setInstallStates((s) => ({ ...s, [plugin.name]: 'loading' }));
    setErrors((e) => ({ ...e, [plugin.name]: '' }));
    try {
      // Attribute the install to the originating marketplace so Claude Code
      // shows it correctly. The synthetic local marketplace is
      // only used for owned/raw-URL imports — when installing FROM it, omit
      // marketplaceId so the installer falls back to the default.
      const params: Record<string, unknown> = { plugin, scope: 'personal' };
      if (marketplace.id !== LOCAL_MARKETPLACE_ID) {
        params['marketplaceId'] = marketplace.id;
      }
      await callIpc('plugin.installFromMarketplace', params);
      setInstallStates((s) => ({ ...s, [plugin.name]: 'done' }));
      setToast({ variant: 'success', message: `${plugin.name} instalado` });
    } catch (err) {
      const message = err instanceof IpcCallError ? err.message : String(err);
      setInstallStates((s) => ({ ...s, [plugin.name]: 'idle' }));
      setErrors((e) => ({ ...e, [plugin.name]: message }));
    }
  };

  const handleConfirmInstall = async (): Promise<void> => {
    if (!previewPlugin) return;
    const plugin = previewPlugin;
    await handleInstall(plugin);
    setPreviewPlugin(null);
  };

  const plugins = marketplace.manifest?.plugins ?? [];
  const isLocal = marketplace.id === LOCAL_MARKETPLACE_ID || marketplace.source.kind === 'directory';
  const isOfficial =
    marketplace.source.kind === 'github' && marketplace.source.repo === OFFICIAL_REPO;
  const label = sourceLabel(marketplace.source);

  const entity: EntityDef<MarketplacePlugin> = {
    name: 'marketplace-plugin',
    pluralName: 'plugins',
    getKey: (plugin) => plugin.name,
    fields: [
      {
        key: 'name',
        label: 'Name',
        primary: true,
        searchable: true,
      },
      {
        key: 'category',
        label: 'Category',
        badge: true,
        searchable: true,
      },
      {
        key: 'description',
        label: 'Description',
        secondary: true,
        searchable: true,
        render: (plugin) => (
          <Box>
            <Box component="span">{plugin.description}</Box>
            {plugin.author && (
              <Typography variant="caption" sx={{ display: 'block' }}>
                by {plugin.author.name}
              </Typography>
            )}
            {errors[plugin.name] && (
              <Typography
                variant="caption"
                color="error"
                sx={{ display: 'block', mt: 0.5 }}
                data-testid={`marketplace-plugin-error-${plugin.name}`}
              >
                {errors[plugin.name]}
              </Typography>
            )}
          </Box>
        ),
      },
      {
        key: 'author.name',
        label: 'Author',
        hideInCard: true,
        searchable: true,
      },
    ],
  };

  const cardSlots: CardSlots<MarketplacePlugin> = {
    footer: (plugin) => {
      const state = installStates[plugin.name];
      return (
        <Button
          size="small"
          variant={state === 'done' ? 'outlined' : 'contained'}
          disabled={state !== undefined && state !== 'idle'}
          onClick={() => setPreviewPlugin(plugin)}
          data-testid={`marketplace-plugin-install-${plugin.name}`}
        >
          {installButtonLabel(state)}
        </Button>
      );
    },
  };

  return (
    <Box data-testid="marketplace-detail">
      <Stack direction="row" sx={{ mb: 2, alignItems: 'flex-start' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h5" component="h2">
            {marketplace.manifest?.name ?? marketplace.id}
          </Typography>
          <Chip
            label={isLocal ? 'local' : label.badge}
            size="small"
            color={isLocal ? 'default' : 'primary'}
            variant={isLocal ? 'outlined' : 'filled'}
          />
          {isOfficial && (
            <Chip
              icon={<Icon glyph={BadgeCheck} size={14} />}
              label="official"
              size="small"
              color="primary"
              data-testid="marketplace-official-badge"
            />
          )}
        </Stack>
      </Stack>
      {marketplace.manifest?.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {marketplace.manifest.description}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        {label.href ? (
          <Link
            href={label.href}
            underline="hover"
            onClick={(e) => {
              e.preventDefault();
              void openManualTab(label.href);
            }}
          >
            {label.detail}
          </Link>
        ) : (
          label.detail
        )}
      </Typography>

      {!marketplace.manifest && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          O manifesto do marketplace não pôde ser carregado. Tente atualizar o marketplace.
        </Alert>
      )}

      <EntityDataGrid<MarketplacePlugin>
        entity={entity}
        data={plugins}
        cardSlots={cardSlots}
        searchPlaceholder="Buscar plugins"
        emptyState={
          <Box
            sx={{
              border: 1,
              borderStyle: 'dashed',
              borderColor: 'divider',
              borderRadius: 1,
              p: 4,
              textAlign: 'center',
              color: 'text.secondary',
            }}
          >
            <Typography variant="body2">
              Nenhum plugin listado neste marketplace.
            </Typography>
          </Box>
        }
      />

      <PluginInstallPreviewDialog
        open={previewPlugin !== null}
        plugin={previewPlugin}
        installing={
          previewPlugin !== null && installStates[previewPlugin.name] === 'loading'
        }
        onCancel={() => setPreviewPlugin(null)}
        onConfirm={() => void handleConfirmInstall()}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}
