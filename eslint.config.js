import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/.data/**', '_source_nomir/**', 'apps/server/drizzle/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['apps/server/**', 'packages/**', 'scripts/**', '**/*.config.{js,ts}', '**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
  },
);
