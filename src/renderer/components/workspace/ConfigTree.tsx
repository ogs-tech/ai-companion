import { Box } from '@mui/material';
import { SectionHeader } from '../ds/ContainerChrome.js';
import { TreeRow, treeGroupLabelSx } from '../ds/TreeRow.js';
import { configGroups, type ConfigPageId } from '../../screens/config/config-pages.js';

interface ConfigTreeProps {
  /** The page whose Workbench tab is in front, if any. */
  activePage: ConfigPageId | null;
  onOpenPage: (page: ConfigPageId) => void;
}

/** The Config view: settings grouped by domain; each leaf opens (or focuses) its Workbench tab. */
export function ConfigTree({ activePage, onOpenPage }: ConfigTreeProps): React.ReactElement {
  return (
    <Box data-testid="config-tree" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'auto', pt: 0.5 }}>
      <SectionHeader title="Configurações" level="view" testId="config-header" />
      {configGroups().map((group) => (
        <Box key={group.id} role="group" aria-label={group.label} sx={{ mb: 1 }}>
          <Box sx={{ ...treeGroupLabelSx, px: 1.5, py: 0.5 }}>{group.label}</Box>
          {group.pages.map((page) => (
            <TreeRow
              key={page.id}
              testId={`config-leaf-${page.id}`}
              pl={1.5}
              glyph={page.glyph}
              primary={page.label}
              selected={activePage === page.id}
              onClick={() => onOpenPage(page.id)}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}
