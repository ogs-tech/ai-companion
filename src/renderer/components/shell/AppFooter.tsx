import { Box, Link } from '@mui/material';
import { Kicker } from '../ds/Kicker.js';
import { brand } from '../../../shared/brand.js';
import { openManualTab } from '../../lib/browser-tabs-store.js';

/** Slim global footer carrying the company brand line (moved out of the TopNav). */
export function AppFooter(): React.ReactElement {
  return (
    <Box
      component="footer"
      data-testid="app-footer"
      sx={(theme) => ({
        flexShrink: 0,
        borderTop: `1px solid ${theme.palette.divider}`,
        bgcolor: 'background.paper',
        px: 3,
        py: 1,
        display: 'flex',
        alignItems: 'center',
      })}
    >
      <Kicker>
        <Link
          href={brand.companyUrl}
          underline="hover"
          color="inherit"
          sx={{ font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}
          onClick={(e) => {
            e.preventDefault();
            void openManualTab(brand.companyUrl);
          }}
        >
          {brand.companyLine}
        </Link>
      </Kicker>
    </Box>
  );
}
