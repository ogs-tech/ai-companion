import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import { App } from './App.js';
import { ThemeModeProvider } from './lib/theme-mode-context.js';
import { brand } from '../shared/brand.js';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

document.title = brand.documentTitle;

createRoot(root).render(
  <StrictMode>
    <ThemeModeProvider>
      <App />
    </ThemeModeProvider>
  </StrictMode>,
);
