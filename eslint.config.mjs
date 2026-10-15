import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/output/**',
      '**/coverage/**',
      'apps/mobile/ios/**',
      'apps/mobile/android/**',
      'apps/mobile/src/assets/**',
      'apps/web/src/assets/**',
      'assets/**',
      'patches/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/site/**/*.{ts,tsx}', 'apps/mobile/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    // Smoke scripts and mobile webview scripts run snippets inside a browser page.
    files: ['scripts/smoke/**/*.mjs', 'apps/mobile/scripts/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
