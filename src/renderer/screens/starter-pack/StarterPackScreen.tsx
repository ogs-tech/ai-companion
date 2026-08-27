import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  Container,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Rocket, CheckCircle2, ArrowRight, ChevronDown, Search } from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { ScreenHeader } from '../../components/ds/ScreenHeader.js';
import type { Nav } from '../../components/shell/nav.js';
import { PluginInstallPreviewDialog } from '../marketplaces/PluginInstallPreviewDialog.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { useStarterPack } from '../../hooks/use-starter-pack.js';
import { useActiveWorkspace, useSwitchWorkspace } from '../../hooks/use-workspaces.js';
import { brand } from '../../../shared/brand.js';
import {
  STARTER_PACK_GROUPS,
  type MarketplacePlugin,
  type StarterGroup,
} from './groups.js';

interface StarterPackScreenProps {
  onNavigate: (nav: Nav) => void;
}

export function StarterPackScreen({ onNavigate }: StarterPackScreenProps): React.ReactElement {
  const { isLoading, profileConfigured, plugins, stateFor, install, reenable } = useStarterPack();
  const { data: activeWorkspace } = useActiveWorkspace();
  const switchWorkspace = useSwitchWorkspace();

  // Personal Instruction now lives inline on the Global workspace's Visão
  // geral — jump there, switching back to Default first (mirrors AppShell's
  // "Workspace" tab "go home" gesture) so this always lands on the Personal
  // Instruction card regardless of which workspace is currently active.
  const openPersonalInstruction = (): void => {
    if (activeWorkspace && !activeWorkspace.isDefault) {
      void switchWorkspace.mutateAsync('default');
    }
    onNavigate({ area: 'workspace', sub: 'visao-geral' });
  };

  // UI-only state — intentionally local. Resetting these on navigation is
  // expected; the install state that must persist lives in the query cache.
  const [previewPlugin, setPreviewPlugin] = useState<MarketplacePlugin | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(STARTER_PACK_GROUPS.map((g) => [g.id, Boolean(g.defaultCollapsed)])),
  );
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const handleConfirmInstall = async (): Promise<void> => {
    if (!previewPlugin) return;
    const plugin = previewPlugin;
    try {
      const { failed, lastError } = await install([plugin]);
      if (failed > 0) {
        setToast({
          variant: 'error',
          message: lastError
            ? `${plugin.name} falhou ao instalar — ${lastError}`
            : `${plugin.name} falhou ao instalar`,
        });
      } else {
        setToast({ variant: 'success', message: `${plugin.name} instalado` });
      }
    } finally {
      setPreviewPlugin(null);
    }
  };

  const handleReenable = async (name: string): Promise<void> => {
    try {
      await reenable(name);
      setToast({ variant: 'success', message: `${name} reabilitado` });
    } catch (err) {
      const detail = err instanceof Error ? ` — ${err.message}` : '';
      setToast({ variant: 'error', message: `${name} falhou ao reabilitar${detail}` });
    }
  };

  const handleInstallGroup = async (
    group: StarterGroup,
    groupPlugins: MarketplacePlugin[],
  ): Promise<void> => {
    const pending = groupPlugins.filter((p) => stateFor(p.name) === 'idle');
    if (pending.length === 0) return;
    const { failed, lastError } = await install(pending);
    if (failed > 0) {
      setToast({
        variant: 'error',
        message: lastError
          ? `${failed} plugin(s) em ${group.label} falharam ao instalar — ${lastError}`
          : `${failed} plugin(s) em ${group.label} falharam ao instalar`,
      });
    } else {
      setToast({ variant: 'success', message: `${group.label} instalado` });
    }
  };

  const installedCount = plugins.filter((p) => stateFor(p.name) === 'done').length;
  const totalCount = plugins.length;
  const progress = totalCount > 0 ? (installedCount / totalCount) * 100 : 0;

  const query = search.trim().toLowerCase();
  const matchesSearch = (p: MarketplacePlugin): boolean =>
    !query ||
    p.name.toLowerCase().includes(query) ||
    (p.description?.toLowerCase().includes(query) ?? false) ||
    (p.category?.toLowerCase().includes(query) ?? false);

  const grouped = STARTER_PACK_GROUPS.map((group) => {
    const order = new Map(group.plugins.map((name, i) => [name, i]));
    const items = plugins
      .filter((p) => order.has(p.name) && matchesSearch(p))
      .sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
    return { group, items };
  }).filter((g) => g.items.length > 0);

  return (
    <Container
      component="main"
      data-testid="starter-pack-screen"
      maxWidth="lg"
      sx={{
        py: 2.5,
        '@keyframes starterFadeIn': {
          from: { opacity: 0, transform: 'translateY(8px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
      }}
    >
      <ScreenHeader
        kicker="Plugins"
        title={brand.starterPackTitle}
        subtitle="Deixe seu ambiente AI pronto em minutos"
        actions={
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#2b5cff',
              backgroundColor: '#2b5cff1a',
            }}
          >
            <Icon glyph={Rocket} size={20} />
          </Box>
        }
      />

      <Paper
        variant="outlined"
        data-testid="starter-pack-profile-card"
        sx={{
          p: 2.5,
          mb: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            Perfil AI
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Instruções globais sob medida para engenheiros de software
          </Typography>
        </Box>
        {profileConfigured === null ? (
          <Chip label="Verificando…" size="small" />
        ) : profileConfigured ? (
          <Chip
            label="Configurado"
            color="success"
            size="small"
            icon={<Icon glyph={CheckCircle2} size={16} />}
          />
        ) : (
          <Button
            variant="outlined"
            size="small"
            endIcon={<Icon glyph={ArrowRight} size={16} />}
            onClick={openPersonalInstruction}
          >
            Configurar
          </Button>
        )}
      </Paper>

      {!isLoading && totalCount > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{
              justifyContent: 'space-between',
              alignItems: { sm: 'center' },
              mb: 1.5,
            }}
          >
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Plugins recomendados
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Instale um grupo por vez — {installedCount} de {totalCount} instalados
              </Typography>
            </Box>
            <TextField
              size="small"
              placeholder="Buscar plugins…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Icon glyph={Search} size={16} />
                    </InputAdornment>
                  ),
                },
                htmlInput: { 'data-testid': 'starter-pack-search' },
              }}
              sx={{ minWidth: { sm: 240 } }}
            />
          </Stack>
          <LinearProgress
            variant="determinate"
            value={progress}
            color="secondary"
            sx={{ height: 8, borderRadius: 1 }}
          />
        </Paper>
      )}

      {!isLoading && plugins.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Adicione o marketplace oficial para descobrir plugins recomendados.
          </Typography>
          <Button
            size="small"
            endIcon={<Icon glyph={ArrowRight} size={16} />}
            onClick={() => onNavigate({ area: 'plugins', sub: 'marketplaces' })}
          >
            Ver marketplaces
          </Button>
        </Paper>
      ) : grouped.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {`Nenhum plugin encontrado para "${search}".`}
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {grouped.map(({ group, items }, index) => {
            const groupDone = items.filter((p) => stateFor(p.name) === 'done').length;
            const groupPending = items.filter((p) => stateFor(p.name) === 'idle').length;
            const groupInstalling = items.some((p) => stateFor(p.name) === 'loading');
            const allDone = groupDone === items.length;
            const isOpen = query ? true : !collapsed[group.id];

            return (
              <Paper
                key={group.id}
                variant="outlined"
                data-testid={`starter-pack-group-${group.id}`}
                sx={{
                  overflow: 'hidden',
                  animation: 'starterFadeIn 320ms ease both',
                  animationDelay: `${index * 55}ms`,
                }}
              >
                <Stack
                  direction="row"
                  spacing={1.5}
                  onClick={() => {
                    if (query) return;
                    setCollapsed((c) => ({ ...c, [group.id]: !c[group.id] }));
                  }}
                  sx={{
                    p: 2,
                    alignItems: 'center',
                    cursor: 'pointer',
                    transition: 'background-color 120ms',
                    '&:hover': { backgroundColor: 'action.hover' },
                  }}
                >
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: 1.5,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: group.accent,
                      backgroundColor: `${group.accent}1a`,
                    }}
                  >
                    {group.icon}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                        {group.label}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${groupDone}/${items.length}`}
                        color={allDone ? 'success' : 'default'}
                        sx={{ height: 20, fontSize: 11 }}
                      />
                    </Stack>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {group.description}
                    </Typography>
                  </Box>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {allDone ? (
                      <Chip
                        size="small"
                        color="success"
                        icon={<Icon glyph={CheckCircle2} size={16} />}
                        label="Instalado"
                      />
                    ) : groupPending > 0 || groupInstalling ? (
                      <Button
                        size="small"
                        variant="contained"
                        disableElevation
                        disabled={groupInstalling || groupPending === 0}
                        onClick={() => void handleInstallGroup(group, items)}
                        data-testid={`starter-pack-install-group-${group.id}`}
                        sx={{ minWidth: 132 }}
                      >
                        {groupInstalling ? 'Instalando…' : `Instalar grupo (${groupPending})`}
                      </Button>
                    ) : null}
                    <IconButton
                      size="small"
                      aria-label={isOpen ? 'Recolher grupo' : 'Expandir grupo'}
                      onClick={() => setCollapsed((c) => ({ ...c, [group.id]: isOpen }))}
                      disabled={Boolean(query)}
                      sx={{
                        transform: isOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 160ms',
                      }}
                    >
                      <Icon glyph={ChevronDown} size={18} />
                    </IconButton>
                  </Stack>
                </Stack>

                <Collapse in={isOpen} timeout="auto" unmountOnExit>
                  <Box
                    sx={{
                      px: 2,
                      pb: 2,
                      pt: 0.5,
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                      gap: 1.5,
                    }}
                  >
                    {items.map((p) => {
                      const state = stateFor(p.name);
                      const done = state === 'done';
                      const disabled = state === 'disabled';
                      return (
                        <Card
                          key={p.name}
                          variant="outlined"
                          data-testid={`starter-plugin-card-${p.name}`}
                          sx={{
                            p: 1.5,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.75,
                            borderColor: done ? 'success.main' : 'divider',
                          }}
                        >
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                            }}
                          >
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 600, wordBreak: 'break-word' }}
                            >
                              {p.name}
                            </Typography>
                            {done && (
                              <Box component="span" sx={{ color: 'success.main', display: 'inline-flex' }}>
                                <Icon glyph={CheckCircle2} size={16} />
                              </Box>
                            )}
                            {disabled && (
                              <Chip
                                size="small"
                                variant="outlined"
                                label="Desabilitado"
                                data-testid={`starter-plugin-disabled-${p.name}`}
                                sx={{ height: 20, fontSize: 11 }}
                              />
                            )}
                          </Stack>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              flex: 1,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {p.description}
                          </Typography>
                          <Box sx={{ mt: 0.5 }}>
                            {disabled ? (
                              <Button
                                size="small"
                                variant="contained"
                                disableElevation
                                onClick={() => void handleReenable(p.name)}
                                data-testid={`starter-plugin-reenable-${p.name}`}
                                sx={{ minWidth: 92 }}
                              >
                                Reabilitar
                              </Button>
                            ) : (
                              <Button
                                size="small"
                                variant={done ? 'outlined' : 'contained'}
                                disableElevation
                                disabled={state !== 'idle'}
                                onClick={() => setPreviewPlugin(p)}
                                data-testid={`starter-plugin-install-${p.name}`}
                                sx={{ minWidth: 92 }}
                              >
                                {done ? 'Instalado' : state === 'loading' ? 'Instalando…' : 'Instalar'}
                              </Button>
                            )}
                          </Box>
                        </Card>
                      );
                    })}
                  </Box>
                </Collapse>
              </Paper>
            );
          })}

          <Stack direction="row" sx={{ mt: 1, justifyContent: 'flex-end' }}>
            <Button
              size="small"
              endIcon={<Icon glyph={ArrowRight} size={16} />}
              onClick={() => onNavigate({ area: 'plugins', sub: 'marketplaces' })}
            >
              Ver todos os marketplaces
            </Button>
          </Stack>
        </Stack>
      )}

      <PluginInstallPreviewDialog
        open={previewPlugin !== null}
        plugin={previewPlugin}
        installing={previewPlugin !== null && stateFor(previewPlugin.name) === 'loading'}
        onCancel={() => setPreviewPlugin(null)}
        onConfirm={() => void handleConfirmInstall()}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Container>
  );
}
