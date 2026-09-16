import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@rpgsim/shared': r('./packages/shared/src/index.ts'),
      '@rpgsim/sim-core': r('./packages/sim-core/src/index.ts'),
      '@rpgsim/world': r('./packages/world/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    environment: 'node',
    // Determinism tests compare full simulation runs; keep output readable.
    reporters: ['default'],
    testTimeout: 30_000,
  },
});
