import { useSyncExternalStore } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
} from '@mui/material';
import {
  getCurrentDialog,
  settleCurrentDialog,
  subscribeDialogs,
  type DialogRequest,
  type UnsavedDecision,
} from '../lib/dialog-host.js';

/** Renders the head of the `dialog-host` queue. Mounted once, at the app root. */
export function DialogHost(): React.ReactElement | null {
  const request = useSyncExternalStore(subscribeDialogs, getCurrentDialog);
  if (!request) return null;
  // `key` remounts per request so focus and open state never leak between two queued dialogs.
  return request.kind === 'unsaved' ? (
    <UnsavedDialog key={dialogKey(request)} request={request} />
  ) : (
    <ConfirmDialog key={dialogKey(request)} request={request} />
  );
}

const keys = new WeakMap<DialogRequest, number>();
let nextKey = 0;
function dialogKey(request: DialogRequest): number {
  let key = keys.get(request);
  if (key === undefined) {
    key = nextKey++;
    keys.set(request, key);
  }
  return key;
}

function UnsavedDialog({ request }: { request: Extract<DialogRequest, { kind: 'unsaved' }> }): React.ReactElement {
  const { names } = request;
  const single = names.length === 1;
  const answer = (decision: UnsavedDecision): void => {
    request.resolve(decision);
    settleCurrentDialog();
  };
  return (
    <Dialog
      open
      onClose={() => answer('cancel')}
      aria-labelledby="unsaved-dialog-title"
      data-testid="unsaved-dialog"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="unsaved-dialog-title">
        {single ? `Salvar alterações em ${names[0]}?` : `Salvar alterações em ${names.length} abas?`}
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          {single
            ? 'Se você não salvar, as alterações desta aba serão perdidas.'
            : 'Se você não salvar, as alterações destas abas serão perdidas.'}
        </DialogContentText>
        {!single && (
          <List dense data-testid="unsaved-dialog-list" sx={{ listStyleType: 'disc', pl: 3 }}>
            {names.map((name, index) => (
              <ListItem key={`${name}-${index}`} sx={{ display: 'list-item', py: 0 }}>
                {name}
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="error" data-testid="unsaved-discard-btn" onClick={() => answer('discard')} sx={{ mr: 'auto' }}>
          Não salvar
        </Button>
        <Button data-testid="unsaved-cancel-btn" onClick={() => answer('cancel')}>
          Cancelar
        </Button>
        {/* autoFocus: Enter = Salvar; Esc goes through the Dialog's onClose = Cancelar. */}
        <Button autoFocus variant="contained" data-testid="unsaved-save-btn" onClick={() => answer('save')}>
          {single ? 'Salvar' : 'Salvar tudo'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ConfirmDialog({ request }: { request: Extract<DialogRequest, { kind: 'confirm' }> }): React.ReactElement {
  const answer = (confirmed: boolean): void => {
    request.resolve(confirmed);
    settleCurrentDialog();
  };
  return (
    <Dialog
      open
      onClose={() => answer(false)}
      aria-labelledby="confirm-dialog-title"
      data-testid="confirm-dialog"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="confirm-dialog-title">{request.title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{request.message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button data-testid="confirm-cancel-btn" onClick={() => answer(false)}>
          Cancelar
        </Button>
        <Button autoFocus variant="contained" color="error" data-testid="confirm-ok-btn" onClick={() => answer(true)}>
          {request.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
