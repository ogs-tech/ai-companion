import { useState } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, X, XCircle } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { treeGroupLabelSx } from '../ds/TreeRow.js';
import type { WorkbenchTab } from './WorkbenchCanvas.js';

interface OpenEditorsSectionProps {
  /** Every closable Workbench tab, in strip order — the pinned "Visão geral" is not one. */
  tabs: readonly WorkbenchTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onCloseAll: () => void;
}

/**
 * The Workbench's tab strip as a list: the same tabs, in the same order, so a
 * long strip never hides one. Pinned at the top of the Explorer; the mirror of
 * the Terminais section at its bottom.
 */
export function OpenEditorsSection({ tabs, activeTabId, onSelect, onCloseAll }: OpenEditorsSectionProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);

  return (
    <Box data-testid="open-editors-section" sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, maxHeight: '40%', display: 'flex', flexDirection: 'column' }}>
      <Box
        data-testid="open-editors-header"
        onClick={() => setExpanded((v) => !v)}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 1, pr: 0.5, py: 0.25, cursor: 'pointer' }}
      >
        <Icon glyph={expanded ? ChevronDown : ChevronRight} size={14} />
        <Typography component="span" sx={{ ...treeGroupLabelSx, flex: 1 }}>Editores abertos</Typography>
        <Typography component="span" sx={{ fontSize: '0.6875rem', color: 'text.disabled' }}>{tabs.length}</Typography>
        {tabs.length > 0 && (
          <Tooltip title="Fechar todos">
            <Box
              component="span"
              role="button"
              tabIndex={0}
              aria-label="Editores abertos: fechar todos"
              data-testid="open-editors-close-all"
              onClick={(e) => {
                e.stopPropagation();
                onCloseAll();
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                onCloseAll();
              }}
              sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
            >
              <Icon glyph={XCircle} size={14} />
            </Box>
          </Tooltip>
        )}
      </Box>
      {expanded && (
        <Box sx={{ overflowY: 'auto', pb: 0.5 }}>
          {tabs.length === 0 && (
            <Typography variant="caption" color="text.secondary" data-testid="open-editors-empty" sx={{ display: 'block', px: 1.5, py: 0.75 }}>
              Nenhum editor aberto
            </Typography>
          )}
          {tabs.map((tab) => (
            <Box
              key={tab.id}
              data-testid={`open-editor-row-${tab.id}`}
              aria-current={tab.id === activeTabId ? 'true' : undefined}
              onClick={() => onSelect(tab.id)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75, pl: 1.5, pr: 0.5, py: 0.25, cursor: 'pointer',
                bgcolor: tab.id === activeTabId ? 'action.selected' : undefined,
                '&:hover': { bgcolor: 'action.hover' },
                '&:hover .open-editor-close, &:focus-within .open-editor-close': { visibility: 'visible' },
              }}
            >
              <Icon glyph={tab.glyph} size={14} />
              <Typography component="span" sx={{ fontSize: '0.8rem', flex: 1, minWidth: 0 }} noWrap>{tab.label}</Typography>
              {tab.breadcrumb !== undefined && (
                <Typography component="span" sx={{ fontSize: '0.7rem', color: 'text.secondary', minWidth: 0, maxWidth: '45%' }} noWrap>
                  {tab.breadcrumb}
                </Typography>
              )}
              {tab.dirty === true && <Box data-testid={`open-editor-dirty-${tab.id}`} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'text.secondary', flexShrink: 0 }} />}
              {tab.onClose !== undefined && (
                <Tooltip title={tab.closeLabel ?? 'Fechar'}>
                  <Box
                    component="span"
                    role="button"
                    tabIndex={0}
                    className="open-editor-close"
                    aria-label={`Editores abertos: ${(tab.closeLabel ?? "Fechar").toLowerCase()} ${tab.label}`}
                    data-testid={`open-editor-close-${tab.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      tab.onClose?.();
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      e.stopPropagation();
                      tab.onClose?.();
                    }}
                    sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer', visibility: 'hidden' }}
                  >
                    <Icon glyph={X} size={13} />
                  </Box>
                </Tooltip>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
