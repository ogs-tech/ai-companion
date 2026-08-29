import { useState, type Dispatch, type SetStateAction } from 'react';
import {
  Alert, Box, Checkbox, FormControl, FormControlLabel, FormGroup, InputLabel, MenuItem, Select,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { callIpc } from '../../lib/ipc.js';
import { useFindOrCreateProjectByPath, useProjects } from '../../hooks/use-projects.js';
import { useActiveWorkspace } from '../../hooks/use-workspaces.js';
import type { Agent, Instruction, Scope, Skill } from '../../../shared/entity.js';

export type EditableEntity = Skill | Agent | Instruction;
export type EditorHiddenField = 'name' | 'scope' | 'description' | 'version';

const scopeOptionsFor = (kind: EditableEntity['kind']): readonly Scope[] =>
  kind === 'instruction' ? (['personal', 'project'] as const) : (['personal', 'workspace', 'project'] as const);

const SCOPE_LABEL: Record<Scope, string> = { personal: 'Personal', workspace: 'Workspace', project: 'Project' };
const NEW_PROJECT_OPTION = '__new_project__';

function clearScopeId<T extends { scopeId?: string }>(entity: T): T {
  const { scopeId: _drop, ...rest } = entity;
  return rest as T;
}

interface PropertiesFormProps {
  entity: EditableEntity;
  onChange: Dispatch<SetStateAction<EditableEntity>>;
  hiddenFields?: ReadonlySet<EditorHiddenField>;
  readOnly: boolean;
}

/** The frontmatter strip — name/description/version/scope — for entity tabs (Skill/Agent/Instruction) in EditorPanel. */
export function PropertiesForm({ entity, onChange, hiddenFields, readOnly }: PropertiesFormProps): React.ReactElement {
  const { data: projects = [] } = useProjects();
  const activeWorkspace = useActiveWorkspace();
  const findOrCreateProject = useFindOrCreateProjectByPath();
  const [projectPickerError, setProjectPickerError] = useState<string | null>(null);

  const isHidden = (field: EditorHiddenField): boolean => hiddenFields?.has(field) ?? false;

  const handleScopeChange = (value: Scope | null): void => {
    if (!value) return;
    const scopeId = value === 'workspace' ? activeWorkspace.data?.id : undefined;
    onChange((prev) => {
      const cleared = clearScopeId(prev);
      return (scopeId !== undefined
        ? { ...cleared, scopes: [value], scopeId }
        : { ...cleared, scopes: [value] }) as EditableEntity;
    });
  };

  const handleProjectSelectChange = async (value: string): Promise<void> => {
    if (value === NEW_PROJECT_OPTION) {
      setProjectPickerError(null);
      try {
        const picked = await callIpc<{ canceled: boolean; path?: string }>('dialog.selectFolder', {});
        if (picked.canceled || !picked.path) return;
        const project = await findOrCreateProject.mutateAsync(picked.path);
        onChange((prev) => ({ ...prev, scopes: ['project'], scopeId: project.id } as EditableEntity));
      } catch (err) {
        setProjectPickerError(err instanceof Error ? err.message : 'Erro ao abrir o seletor');
      }
      return;
    }
    onChange((prev) => ({ ...prev, scopes: ['project'], scopeId: value } as EditableEntity));
  };

  return (
    <Stack spacing={2}>
      {!isHidden('name') && (
        <TextField
          label="Name"
          value={entity.name}
          onChange={(e) => onChange((prev) => ({ ...prev, name: e.target.value } as EditableEntity))}
          slotProps={{ htmlInput: { pattern: '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$', title: 'lowercase letters, digits and hyphens only (1-64 chars, no leading/trailing hyphen)' } }}
          disabled={readOnly}
          fullWidth
        />
      )}
      {!isHidden('description') && (
        <TextField
          label="Description"
          value={entity.description}
          onChange={(e) => onChange((prev) => ({ ...prev, description: e.target.value }))}
          slotProps={{ htmlInput: { maxLength: 200 } }}
          helperText={`${entity.description.length}/200`}
          disabled={readOnly}
          fullWidth
        />
      )}
      {!isHidden('version') && (
        <TextField
          label="Version"
          value={entity.metadata.version}
          onChange={(e) => onChange((prev) => ({ ...prev, metadata: { ...prev.metadata, version: e.target.value } }))}
          disabled={readOnly}
          sx={{ maxWidth: 200 }}
        />
      )}
      {!isHidden('scope') && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Scope</Typography>
          {entity.kind === 'skill' || entity.kind === 'agent' ? (
            <>
              <ToggleButtonGroup
                exclusive
                size="small"
                disabled={readOnly}
                value={entity.scopes[0] ?? 'personal'}
                onChange={(_, value: Scope | null) => handleScopeChange(value)}
              >
                {scopeOptionsFor(entity.kind).map((value) => (
                  <ToggleButton key={value} value={value}>{SCOPE_LABEL[value]}</ToggleButton>
                ))}
              </ToggleButtonGroup>
              {entity.scopes[0] === 'project' && (
                <FormControl size="small" disabled={readOnly} sx={{ mt: 1.5, minWidth: 260, display: 'block' }}>
                  <InputLabel id="scope-project-select-label">Project</InputLabel>
                  <Select
                    labelId="scope-project-select-label"
                    label="Project"
                    value={entity.scopeId ?? ''}
                    onChange={(e) => void handleProjectSelectChange(e.target.value)}
                  >
                    {projects.map((p) => (
                      <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                    ))}
                    <MenuItem value={NEW_PROJECT_OPTION}>+ Novo project…</MenuItem>
                  </Select>
                </FormControl>
              )}
              {projectPickerError && (
                <Alert severity="error" sx={{ mt: 1 }}>{projectPickerError}</Alert>
              )}
            </>
          ) : (
            <FormGroup row>
              {(scopeOptionsFor(entity.kind)).map((value) => (
                <FormControlLabel
                  key={value}
                  control={
                    <Checkbox
                      checked={(entity.scopes as Scope[]).includes(value)}
                      disabled={readOnly}
                      onChange={(e) => {
                        const scopesArr = entity.scopes as Scope[];
                        const next: Scope[] = e.target.checked
                          ? Array.from(new Set([...scopesArr, value]))
                          : scopesArr.filter((s) => s !== value);
                        onChange((prev) => ({ ...prev, scopes: next } as unknown as EditableEntity));
                      }}
                    />
                  }
                  label={value}
                />
              ))}
            </FormGroup>
          )}
        </Box>
      )}
    </Stack>
  );
}
