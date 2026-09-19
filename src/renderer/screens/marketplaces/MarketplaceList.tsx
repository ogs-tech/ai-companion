import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { Download, RefreshCw, Trash2, BadgeCheck } from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { openManualTab } from '../../lib/browser-tabs-store.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { DetailDrawer } from '../../components/DetailDrawer.js';
import { MarketplaceDetail } from './MarketplaceDetail.js';
import { MarketplaceImportDialog } from './MarketplaceImportDialog.js';
import { EntityDataGrid } from '../../components/EntityDataGrid/index.js';
import type {
  EntityDef,
  RowAction,
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

const LOCAL_MARKETPLACE_ID = 'local';
const OFFICIAL_REPO = 'anthropics/claude-plugins-official';
const MARKETPLACES_QUERY_KEY = ['marketplaces', 'personal'] as const;

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

export function MarketplaceList(): React.ReactElement {
  const qc = useQueryClient();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [confirmRemove, setConfirmRemove] =
    useState<MarketplaceSummary | null>(null);
  const [selected, setSelected] = useState<MarketplaceSummary | null>(null);

  const { data, isLoading, error } = useQuery<MarketplaceSummary[]>({
    queryKey: MARKETPLACES_QUERY_KEY,
    queryFn: async () => {
      const list = await callIpc<MarketplaceSummary[]>('marketplace.list', {
        scope: 'personal',
      });
      return Array.isArray(list)
        ? list.filter((m) => m.id !== LOCAL_MARKETPLACE_ID)
        : [];
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (id: string) => {
      await callIpc('marketplace.refresh', { scope: 'personal', id });
      return id;
    },
    onSuccess: async (id) => {
      setToast({ variant: 'success', message: `${id} atualizado` });
      await qc.invalidateQueries({ queryKey: MARKETPLACES_QUERY_KEY });
    },
    onError: (err) => {
      const message = err instanceof IpcCallError ? err.message : String(err);
      setToast({ variant: 'error', message });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (m: MarketplaceSummary) => {
      await callIpc('marketplace.remove', { scope: 'personal', id: m.id });
      return m;
    },
    onSuccess: async (m) => {
      setToast({ variant: 'success', message: `${m.id} removido` });
      await qc.invalidateQueries({ queryKey: MARKETPLACES_QUERY_KEY });
    },
    onError: (err) => {
      const message = err instanceof IpcCallError ? err.message : String(err);
      setToast({ variant: 'error', message });
    },
  });

  const entity: EntityDef<MarketplaceSummary> = {
    name: 'marketplace',
    pluralName: 'marketplaces',
    getKey: (item) => item.id,
    fields: [
      {
        key: 'manifest.name',
        label: 'Name',
        primary: true,
        searchable: true,
        render: (item) => {
          const isOfficial =
            item.source.kind === 'github' && item.source.repo === OFFICIAL_REPO;
          return (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Box component="span">{item.manifest?.name ?? item.id}</Box>
              {isOfficial && (
                <Chip
                  icon={<Icon glyph={BadgeCheck} size={14} />}
                  label="official"
                  size="small"
                  color="primary"
                  data-testid={`marketplace-${item.id}-official-badge`}
                />
              )}
            </Stack>
          );
        },
      },
      {
        key: 'source.kind',
        label: 'Source',
        badge: true,
        searchable: true,
        render: (item) => {
          const isLocal =
            item.id === LOCAL_MARKETPLACE_ID || item.source.kind === 'directory';
          return isLocal ? 'local' : sourceLabel(item.source).badge;
        },
      },
      {
        key: 'manifest.plugins',
        label: 'Plugins',
        badge: true,
        render: (item) => {
          const count = item.manifest?.plugins.length ?? 0;
          return `${count} plugin${count === 1 ? '' : 's'}`;
        },
      },
      {
        key: 'manifest.description',
        label: 'Description',
        secondary: true,
        searchable: true,
        render: (item) => {
          const label = sourceLabel(item.source);
          return (
            <Box>
              {item.manifest?.description && (
                <span>{item.manifest.description} · </span>
              )}
              {label.href ? (
                <Link
                  href={label.href}
                  underline="hover"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    void openManualTab(label.href);
                  }}
                >
                  {label.detail}
                </Link>
              ) : (
                <span>{label.detail}</span>
              )}
            </Box>
          );
        },
      },
    ],
  };

  const actions: RowAction<MarketplaceSummary>[] = [
    {
      label: 'Atualizar',
      icon: <Icon glyph={RefreshCw} size={16} />,
      onClick: (item) => refreshMutation.mutate(item.id),
    },
    {
      label: 'Remover',
      icon: <Icon glyph={Trash2} size={16} />,
      variant: 'destructive',
      onClick: (item) => setConfirmRemove(item),
    },
  ];

  return (
    <Container
      component="main"
      data-testid="marketplace-list"
      maxWidth="lg"
      sx={{ py: 2.5 }}
    >
      <Stack
        direction="row"
        sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Typography variant="h5" component="h1">
          Marketplaces
        </Typography>
      </Stack>

      <EntityDataGrid<MarketplaceSummary>
        entity={entity}
        data={data}
        isLoading={isLoading}
        error={error}
        actions={actions}
        searchPlaceholder="Buscar marketplaces…"
        onRowClick={(item) => setSelected(item)}
        toolbarActions={
          <Button
            variant="outlined"
            startIcon={<Icon glyph={Download} size={16} />}
            onClick={() => setShowImport(true)}
            data-testid="import-marketplace-button"
          >
            Importar via URL
          </Button>
        }
      />

      <MarketplaceImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onMarketplaceAdded={(id) => {
          setShowImport(false);
          setToast({ variant: 'success', message: `Marketplace ${id} adicionado` });
          void qc.invalidateQueries({ queryKey: MARKETPLACES_QUERY_KEY });
        }}
      />

      <Dialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        aria-label="Confirmar remoção do marketplace"
        data-testid="confirm-remove-marketplace-dialog"
      >
        <DialogTitle>Remover marketplace</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remover o marketplace <strong>{confirmRemove?.id}</strong>? Isso não
            excluirá nenhum plugin instalado; apenas o registro do marketplace
            será removido.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemove(null)}>Cancelar</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              if (confirmRemove) removeMutation.mutate(confirmRemove);
              setConfirmRemove(null);
            }}
          >
            Confirmar
          </Button>
        </DialogActions>
      </Dialog>

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <DetailDrawer
        open={selected !== null}
        onClose={() => {
          setSelected(null);
          void qc.invalidateQueries({ queryKey: MARKETPLACES_QUERY_KEY });
        }}
        title={selected?.manifest?.name ?? selected?.id ?? ''}
        testId="marketplace"
      >
        {selected && <MarketplaceDetail marketplace={selected} />}
      </DetailDrawer>
    </Container>
  );
}
