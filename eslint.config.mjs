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
      '@typescript-eslint/no-explicit-any': 'error',
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
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  {
    // Mobile webview scripts run snippets inside a browser page.
    files: ['apps/mobile/scripts/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Provider, JSON-RPC and WebRTC payloads arrive untyped; these boundaries narrow them on use. Elsewhere avoid `any`.
    files: [
      'apps/desktop/src/**/*.ts',
      'apps/mobile/src/components/useComputerVideo.ts',
      'apps/mobile/src/runtime/{store,transport}.{ts,tsx}',
      'apps/server/src/{agent,providers,remote}/**/*.ts',
      'apps/server/src/index.ts',
      'apps/web/src/workspace/hostEvents.ts',
      'apps/web/src/settings/SettingsScope.tsx',
      'packages/client-runtime/src/**/*.ts',
      'packages/contracts/src/**/*.ts',
      'packages/shared/src/chat/agentContent.ts',
    ],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // Tests stub partial objects and private internals.
    files: ['**/test/**/*.{ts,tsx,mjs}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
