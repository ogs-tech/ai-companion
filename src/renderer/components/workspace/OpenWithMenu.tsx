import { useState } from 'react';
import { Box, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { AppWindow, ChevronDown, FolderSearch } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import {
  useChooseApplication,
  useOpenWith,
  useOpenWithDefault,
  useOpenWithSuggestions,
  type OpenWithTarget,
} from '../../hooks/use-open-with.js';
import type { ExternalApp } from '../../../shared/open-with.js';

interface OpenWithMenuProps {
  /** The "Abrir com" row this submenu hangs off; `null` keeps it closed. */
  anchorEl: HTMLElement | null;
  target: OpenWithTarget | null;
  /** Dismisses the submenu but leaves the row menu it came from open. */
  onClose: () => void;
  /** An application was launched — close the submenu *and* the row menu behind it. */
  onDone: () => void;
  onError?: (message: string) => void;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function AppIcon({ app }: { app: ExternalApp }): React.ReactElement {
  if (app.iconDataUrl === undefined) return <Icon glyph={AppWindow} size={16} />;
  return (
    <Box
      component="img"
      src={app.iconDataUrl}
      alt=""
      data-testid={`open-with-icon-${app.id}`}
      sx={{ width: 16, height: 16, display: 'block' }}
    />
  );
}

/**
 * The "Abrir com" submenu: a second `Menu` anchored to its own row in the row
 * menu, rather than a nested child of it — MUI has no submenu primitive, and
 * a `Menu` inside a `Menu`'s children breaks that menu's focus handling.
 */
export function OpenWithMenu({
  anchorEl,
  target,
  onClose,
  onDone,
  onError,
}: OpenWithMenuProps): React.ReactElement {
  const [showOverflow, setShowOverflow] = useState(false);
  const open = anchorEl !== null && target !== null;

  const { data, isLoading } = useOpenWithSuggestions(target, open);
  const openWith = useOpenWith();
  const openDefault = useOpenWithDefault();
  const chooseApplication = useChooseApplication();

  const run = (action: () => Promise<unknown>): void => {
    // The menu closes on the click, not on the launch: waiting would leave a
    // dead menu on screen for as long as the application takes to come up.
    onDone();
    setShowOverflow(false);
    void action().catch((err: unknown) => onError?.(errorMessage(err)));
  };

  const appItem = (app: ExternalApp): React.ReactElement => (
    <MenuItem
      key={app.id}
      data-testid={`open-with-app-${app.id}`}
      onClick={() => {
        if (target === null) return;
        run(() => openWith.mutateAsync({ target, app: { id: app.id, path: app.path } }));
      }}
    >
      <ListItemIcon><AppIcon app={app} /></ListItemIcon>
      <ListItemText>{app.name}</ListItemText>
      {app.isDefault && (
        <Typography variant="caption" color="text.secondary" sx={{ pl: 2 }}>
          padrão
        </Typography>
      )}
    </MenuItem>
  );

  const primary = data?.primary ?? [];
  const overflow = data?.more ?? [];

  const items: React.ReactNode[] = [];
  if (isLoading) {
    items.push(
      <MenuItem key="loading" disabled data-testid="open-with-loading">
        <ListItemText>Procurando aplicativos…</ListItemText>
      </MenuItem>,
    );
  } else {
    items.push(...primary.map(appItem));
    if (showOverflow) items.push(...overflow.map(appItem));
    else if (overflow.length > 0) {
      items.push(
        <MenuItem
          key="more"
          data-testid="open-with-more"
          onClick={() => setShowOverflow(true)}
        >
          <ListItemIcon><Icon glyph={ChevronDown} size={16} /></ListItemIcon>
          <ListItemText>{`Mais apps (${overflow.length})`}</ListItemText>
        </MenuItem>,
      );
    }
    if (primary.length === 0) {
      // Either the platform has no application discovery, or Launch Services
      // knows nothing about this type. The OS can still be asked to do
      // whatever it would do on a double-click.
      items.push(
        <MenuItem
          key="default"
          data-testid="open-with-default"
          onClick={() => {
            if (target === null) return;
            run(() => openDefault.mutateAsync(target));
          }}
        >
          <ListItemIcon><Icon glyph={AppWindow} size={16} /></ListItemIcon>
          <ListItemText>Abrir com o aplicativo padrão</ListItemText>
        </MenuItem>,
      );
    }
    items.push(<Divider key="divider" />);
    items.push(
      <MenuItem
        key="choose"
        data-testid="open-with-choose"
        onClick={() => {
          if (target === null) return;
          run(() => chooseApplication.mutateAsync(target));
        }}
      >
        <ListItemIcon><Icon glyph={FolderSearch} size={16} /></ListItemIcon>
        <ListItemText>Escolher outro app…</ListItemText>
      </MenuItem>,
    );
  }

  return (
    <Menu
      data-testid="open-with-menu"
      open={open}
      anchorEl={anchorEl}
      onClose={() => {
        setShowOverflow(false);
        onClose();
      }}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ list: { dense: true } }}
    >
      {items}
    </Menu>
  );
}
