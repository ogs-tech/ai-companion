import { useState, useSyncExternalStore } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
} from '@mui/material';
import {
  getCurrentDialog,
  settleCurrentDialog,
  subscribeDialogs,
  type ConflictDecision,
  type DialogRequest,
  type UnsavedDecision,
} from '../lib/dialog-host.js';

/** Renders the head of the `dialog-host` queue. Mounted once, at the app root. */
export function DialogHost(): React.ReactElement | null {
  const request = useSyncExternalStore(subscribeDialogs, getCurrentDialog);
  if (!request) return null;
  // `key` remounts per request so focus and open state never leak between two queued dialogs.
  if (request.kind === 'unsaved') return <UnsavedDialog key={dialogKey(request)} request={request} />;
  if (request.kind === 'trash') return <TrashDialog key={dialogKey(request)} request={request} />;
  if (request.kind === 'conflict') return <ConflictDialog key={dialogKey(request)} request={request} />;
  return <ConfirmDialog key={dialogKey(request)} request={request} />;
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

function TrashDialog({ request }: { request: Extract<DialogRequest, { kind: 'trash' }> }): React.ReactElement {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const { names } = request;
  const single = names.length === 1;
  const answer = (confirmed: boolean): void => {
    request.resolve({ confirmed, dontAskAgain: confirmed && dontAskAgain });
    settleCurrentDialog();
  };
  return (
    <Dialog open onClose={() => answer(false)} aria-labelledby="trash-dialog-title" data-testid="trash-dialog" maxWidth="xs" fullWidth>
      <DialogTitle id="trash-dialog-title">
        {single ? `Mover "${names[0]}" para a lixeira?` : `Mover ${names.length} itens para a lixeira?`}
      </DialogTitle>
      <DialogContent>
        <DialogContentText>Você poderá recuperar {single ? 'o item' : 'os itens'} pela lixeira do sistema.</DialogContentText>
        <FormControlLabel
          sx={{ mt: 1 }}
          control={<Checkbox size="small" checked={dontAskAgain} onChange={(e) => setDontAskAgain(e.target.checked)} slotProps={{ input: { 'data-testid': 'trash-dont-ask' } as React.InputHTMLAttributes<HTMLInputElement> }} />}
          label="Não perguntar novamente"
        />
      </DialogContent>
      <DialogActions>
        <Button data-testid="trash-cancel-btn" onClick={() => answer(false)}>Cancelar</Button>
        <Button autoFocus variant="contained" color="error" data-testid="trash-ok-btn" onClick={() => answer(true)}>
          Mover para a lixeira
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ConflictDialog({ request }: { request: Extract<DialogRequest, { kind: 'conflict' }> }): React.ReactElement {
  const { question } = request;
  const [applyToAll, setApplyToAll] = useState(false);
  const answer = (decision: ConflictDecision | null): void => {
    request.resolve(decision);
    settleCurrentDialog();
  };
  const choose = (resolution: ConflictDecision['resolution']): void => answer({ resolution, applyToAll });
  return (
    <Dialog open onClose={() => answer(null)} aria-labelledby="conflict-dialog-title" data-testid="conflict-dialog" maxWidth="xs" fullWidth>
      <DialogTitle id="conflict-dialog-title">{`"${question.name}" já existe aqui`}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {question.kindMismatch
            ? 'Um arquivo e uma pasta não podem ter o mesmo nome. Mantenha os dois ou pule este item.'
            : 'O que fazer com o item que já está neste destino?'}
        </DialogContentText>
        {question.remaining > 0 && (
          <FormControlLabel
            sx={{ mt: 1 }}
            control={<Checkbox size="small" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} slotProps={{ input: { 'data-testid': 'conflict-apply-all' } as React.InputHTMLAttributes<HTMLInputElement> }} />}
            label={`Aplicar a todos (${question.remaining + 1} conflitos)`}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button data-testid="conflict-skip-btn" onClick={() => choose('skip')} sx={{ mr: 'auto' }}>Pular</Button>
        <Button data-testid="conflict-keep-btn" onClick={() => choose('keep-both')}>Manter ambos</Button>
        {!question.kindMismatch && (
          <Button autoFocus variant="contained" color="error" data-testid="conflict-replace-btn" onClick={() => choose('replace')}>
            Substituir
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
