import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/cdk.out/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/simulator/public/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        fetch: 'readonly',
        window: 'readonly',
        setInterval: 'readonly',
        Audio: 'readonly',
        URL: 'readonly',
        SpeechSynthesisUtterance: 'readonly',
      },
    },
  },
  // TypeScript already reports undefined names; no-undef only produces false positives on globals.
  { files: ['**/*.ts'], rules: { 'no-undef': 'off' } },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
);
