import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { settingsQueryKey, useSettings } from './use-settings.js';

export interface UiPreferences {
  /** Soft-wrap long lines in editors. On unless explicitly turned off. */
  wordWrap: boolean;
  /** Ask before moving to the trash. On unless the user ticked "Não perguntar novamente". */
  confirmTrash: boolean;
  setWordWrap: (next: boolean) => void;
  setConfirmTrash: (next: boolean) => void;
}

/** The two global UI preferences this slice adds to `Settings.ui`; both default to true. */
export function useUiPreferences(): UiPreferences {
  const { data: settings } = useSettings();
  const queryClient = useQueryClient();
  const merge = useCallback(
    (ui: { wordWrap?: boolean; confirmTrash?: boolean }) => {
      void callIpc('settings.merge', { ui })
        .then(() => queryClient.invalidateQueries({ queryKey: settingsQueryKey }))
        .catch((err: unknown) => console.warn('Could not save the preference', err));
    },
    [queryClient],
  );
  return {
    wordWrap: settings?.ui?.wordWrap ?? true,
    confirmTrash: settings?.ui?.confirmTrash ?? true,
    setWordWrap: (next) => merge({ wordWrap: next }),
    setConfirmTrash: (next) => merge({ confirmTrash: next }),
  };
}
