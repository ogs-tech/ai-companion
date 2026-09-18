import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/main/application/**',
        'src/main/ipc/**',
        'src/main/infrastructure/**',
        'src/renderer/screens/**',
        'src/renderer/App.tsx',
      ],
      exclude: [
        'src/main/infrastructure/dialog/**',
        'src/main/infrastructure/notification/**',
        'src/main/infrastructure/settings/in-memory-settings-repository.ts',
        'src/main/infrastructure/workspace/in-memory-workspace-registry.ts',
        'src/main/infrastructure/project/in-memory-project-registry.ts',
      ],
      // Ratchet floor: locked to the 2026-06-06 post-cleanup baseline
      // (S78 / B66 / F76 / L80). Raise toward the 80/70 production target as
      // renderer-screen and IPC-handler coverage improves (separate plan).
      thresholds: {
        lines: 80,
        functions: 76,
        statements: 78,
        branches: 66,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/main/**/*.test.ts', 'tests/shared/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          // WorkspaceScreen.test.tsx alone runs 40s; sharing CPU with the rest
          // of the suite stretches it past 120s, and its heaviest tests then
          // cross Vitest's 5s default and fail as timeouts rather than on any
          // assertion. The renderer tests mount real MUI trees — they are slow
          // by nature, not by accident.
          testTimeout: 20_000,
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/renderer/setup.ts'],
        },
      },
    ],
  },
});
