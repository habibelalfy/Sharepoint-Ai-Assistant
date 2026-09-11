/**
 * ESLint flat configuration (ESLint 10).
 *
 * - JavaScript base "recommended" rules (@eslint/js).
 * - TypeScript rules via typescript-eslint (non-type-checked "recommended").
 * - Prettier integration (disables conflicting formatting rules).
 *
 * NOTE: Type-checked linting (`typescript-eslint.configs.recommendedTypeChecked`
 * plus `languageOptions.parserOptions.project`) can be enabled in a later phase
 * once the source tree is more substantial. It is intentionally left out of the
 * Phase 0 scaffold to keep the lint run independent of a project service.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'spfx/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
);
