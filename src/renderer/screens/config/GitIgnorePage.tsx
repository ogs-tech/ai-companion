import { FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Typography } from '@mui/material';
import { callIpc } from '../../lib/ipc.js';
import { useSettingsState } from '../../hooks/use-settings-state.js';
import { resolveGitIgnoreMode, type GitIgnoreMode, type Settings } from '../../../shared/settings.js';
import { ConfigPageFrame } from './ConfigPageFrame.js';

const OPTIONS: { value: GitIgnoreMode; label: string; hint: string }[] = [
  { value: 'local', label: 'Só nesta máquina (.git/info/exclude)', hint: 'Recomendado. Não aparece em diff nem vai para o repositório.' },
  { value: 'gitignore', label: 'No .gitignore do projeto', hint: 'Compartilha a regra com o time, mas o .gitignore passa a aparecer como alterado.' },
  { value: 'off', label: 'Não ocultar', hint: 'Remove o bloco gerenciado; os arquivos voltam a aparecer no git.' },
];

export function GitIgnorePage(): React.ReactElement {
  const { settings, publish } = useSettingsState();

  const handleChange = async (mode: GitIgnoreMode): Promise<void> => {
    publish(await callIpc<Settings>('settings.merge', { git: { ignoreManagedFiles: mode } }));
  };

  return (
    <ConfigPageFrame title="Git e arquivos gerados" testId="config-page-git-ignore">
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
        Oculta do git o <code>.ai-companion/</code> e apenas os links e arquivos que o app gerou em <code>.claude/</code> e <code>.cursor/</code>. Arquivos seus nessas pastas continuam visíveis. Nada rastreado é removido do índice.
      </Typography>
      <FormControl>
        <FormLabel id="git-ignore-label">Ocultar arquivos gerenciados</FormLabel>
        <RadioGroup
          aria-labelledby="git-ignore-label"
          value={resolveGitIgnoreMode(settings)}
          onChange={(e) => void handleChange(e.target.value as GitIgnoreMode)}
        >
          {OPTIONS.map((o) => (
            <FormControlLabel
              key={o.value}
              value={o.value}
              control={<Radio />}
              disabled={settings === null}
              label={
                <>
                  <Typography variant="body2">{o.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{o.hint}</Typography>
                </>
              }
            />
          ))}
        </RadioGroup>
      </FormControl>
    </ConfigPageFrame>
  );
}
