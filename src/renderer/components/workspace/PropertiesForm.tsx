import type { Dispatch, SetStateAction } from 'react';
import {
  Box, Checkbox, FormControlLabel, FormGroup, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { useActiveWorkspace } from '../../hooks/use-workspaces.js';
import type { Agent, Instruction, Scope, Skill } from '../../../shared/entity.js';

export type EditableEntity = Skill | Agent | Instruction;
export type EditorHiddenField = 'name' | 'scope' | 'description' | 'version';

const SCOPE_OPTIONS: readonly Scope[] = ['personal', 'workspace'];

const SCOPE_LABEL: Record<Scope, string> = { personal: 'Personal', workspace: 'Workspace' };

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
  const activeWorkspace = useActiveWorkspace();
  // A workspace entity always belongs to the open workspace — at Início there is none to pick.
  const activeWorkspaceId = activeWorkspace.data?.id;

  const isHidden = (field: EditorHiddenField): boolean => hiddenFields?.has(field) ?? false;

  const handleScopeChange = (value: Scope | null): void => {
    if (!value) return;
    const scopeId = value === 'workspace' ? activeWorkspaceId : undefined;
    onChange((prev) => {
      const cleared = clearScopeId(prev);
      return (scopeId !== undefined
        ? { ...cleared, scopes: [value], scopeId }
        : { ...cleared, scopes: [value] }) as EditableEntity;
    });
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
                {SCOPE_OPTIONS.map((value) => (
                  <ToggleButton
                    key={value}
                    value={value}
                    disabled={value === 'workspace' && activeWorkspaceId === undefined}
                  >
                    {SCOPE_LABEL[value]}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </>
          ) : (
            <FormGroup row>
              {SCOPE_OPTIONS.map((value) => (
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
