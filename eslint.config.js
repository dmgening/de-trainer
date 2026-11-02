import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/.data/**', '**/test-results/**', '**/playwright-report/**', '_source_nomir/**', 'apps/server/drizzle/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: { '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }] },
  },
  {
    // Integration tests poke into JSON responses; typing every body would add noise, not safety.
    files: ['**/test/**', '**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['apps/server/**', 'packages/**', 'scripts/**', 'e2e/**', '**/*.config.{js,ts}', '**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
  },
);
