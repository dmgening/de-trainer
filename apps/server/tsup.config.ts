import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/migrate.ts', 'src/admin.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages are TypeScript sources, so they are bundled; npm deps stay external.
  noExternal: [/^@de-trainer\//],
});
