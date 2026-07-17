import { defineConfig } from 'vitest/config';

// One artifact: /admin/bundle.js. index.html is installer-owned and never
// built — the bundle is the only replaceable part (DESIGN.md, install/update).
export default defineConfig({
  build: {
    lib: {
      entry: 'src/main.tsx',
      formats: ['iife'],
      name: 'DeadSimpleCMS',
      fileName: () => 'bundle.js',
    },
    outDir: 'dist',
    target: 'es2022',
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
