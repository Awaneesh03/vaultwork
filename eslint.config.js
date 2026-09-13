import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

/**
 * Import-boundary enforcement.
 *
 * The architecture only survives if the dependency direction is checked by a
 * machine. A rule nobody enforces is a comment.
 *
 *   components -> hooks -> services -> repositories -> db (Dexie) -> IndexedDB
 *
 * Patterns are written twice on purpose: once for the `@/` alias and once as a
 * bare path glob, so a relative import (`../../db`) cannot sneak past the rule.
 */
const forbid = (paths, patterns, message) => ({
  'no-restricted-imports': [
    'error',
    {
      paths: paths.map((name) => ({ name, message })),
      patterns: patterns.map((group) => ({ group: [group], message })),
    },
  ],
})

const PERSISTENCE_MESSAGE =
  'UI and hook layers must go through services/. Only repositories/ may touch Dexie.'

/** Every package that only the UI layer is allowed to name. */
const UI_PACKAGES = [
  'react',
  'react-dom',
  'react-router-dom',
  'zustand',
  '@dnd-kit/core',
  '@dnd-kit/sortable',
  '@dnd-kit/modifiers',
  '@dnd-kit/utilities',
  'lucide-react',
]

const NO_REACT = forbid(
  UI_PACKAGES,
  ['@/components/**', '@/features/**', '@/app/**', '@/hooks/**', '@/store/**', 'react/**'],
  'This layer must contain no React and no UI. Business logic stays framework-free.',
)

export default tseslint.config(
  // Build output, not source. `src-tauri/target` is Cargo's, and it contains
  // compressed asset blobs with a `.js` extension that no parser can read;
  // `src-tauri/gen` is Tauri's generated schema directory.
  { ignores: ['dist', 'coverage', 'node_modules', 'src-tauri/target', 'src-tauri/gen'] },

  // ---------------------------------------------------------------- baseline
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // --------------------------------------------------------- layer 1: the UI
  // Components render and call hooks. They may hold a *type* from a service,
  // but calling one directly skips the layer that exists to be swapped.
  {
    files: [
      'src/components/**/*.{ts,tsx}',
      'src/features/**/*.{ts,tsx}',
      'src/app/**/*.{ts,tsx}',
      'src/store/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'dexie', message: PERSISTENCE_MESSAGE },
            { name: 'dexie-react-hooks', message: PERSISTENCE_MESSAGE },
          ],
          patterns: [
            {
              group: [
                '@/db',
                '@/db/**',
                '**/db',
                '**/db/**',
                '@/repositories',
                '@/repositories/**',
                '**/repositories',
                '**/repositories/**',
              ],
              message: PERSISTENCE_MESSAGE,
            },
            {
              group: ['@/services', '@/services/**', '**/services', '**/services/**'],
              allowTypeImports: true,
              message: 'Components call hooks, not services. Importing a type is fine.',
            },
          ],
        },
      ],
    },
  },

  // ------------------------------------------------------- layer 2: the glue
  // Hooks are the only place `dexie-react-hooks` is allowed, and the only UI
  // layer that may call a service.
  {
    files: ['src/**/hooks/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'dexie', message: PERSISTENCE_MESSAGE }],
          patterns: [
            {
              group: [
                '@/db',
                '@/db/**',
                '**/db',
                '**/db/**',
                '@/repositories',
                '@/repositories/**',
                '**/repositories',
                '**/repositories/**',
              ],
              message: 'Hooks call services/, never repositories or Dexie directly.',
            },
          ],
        },
      ],
    },
  },

  /*
   * The AI layer (M15).
   *
   * A stricter domain layer than `services/`. Services legitimately reach
   * repositories — that is what a service is for — but the AI layer must not:
   * a model that can read rows directly could act on data no deterministic
   * validator ever saw, and "AI goes through the command layer" would become an
   * intention rather than a rule. Its only way to touch data is the services
   * and the command executor, exactly as every other caller's is.
   */
  {
    files: ['src/ai/**/*.ts'],
    rules: {
      ...forbid(
        [...UI_PACKAGES, 'dexie', 'dexie-react-hooks'],
        [
          '@/components/**',
          '@/features/**',
          '@/app/**',
          '@/hooks/**',
          '@/store/**',
          '@/db/**',
          '**/db',
          '**/db/**',
          '@/repositories/**',
          '**/repositories',
          '**/repositories/**',
          '@/integrations/telegram/**',
          '**/integrations/telegram',
          '**/integrations/telegram/**',
        ],
        'The AI layer reaches data only through services/ and the command layer: no React, no UI, no Dexie, no repositories, no Telegram.',
      ),
    },
  },

  // ---------------------------------------------------------- layer 3: domain
  //
  // `src/ai/**` is deliberately NOT listed here. Flat config resolves one rule
  // per file by last-match-wins, so naming it in both blocks would silently
  // replace the stricter AI policy above with this looser one — and the
  // repositories ban would quietly stop applying. The AI block already forbids
  // everything this one does, plus repositories and Telegram.
  {
    files: ['src/services/**/*.ts'],
    // `telegramService` is the one exception, and it is the adapter itself: its
    // entire job is to turn a chat line into a command the rest of the
    // application already understands. The rule's intent — that `taskService`
    // must never know a channel exists — is unchanged, and is now checked more
    // precisely by `tests/architecture.test.ts`, which asserts that no *other*
    // service imports integrations/telegram.
    ignores: ['src/services/telegramService.ts'],
    rules: {
      ...forbid(
        [...UI_PACKAGES, 'dexie', 'dexie-react-hooks'],
        [
          '@/components/**',
          '@/features/**',
          '@/app/**',
          '@/hooks/**',
          '@/store/**',
          '@/db/**',
          '**/db',
          '**/db/**',
          '@/integrations/telegram/**',
          '**/integrations/telegram',
          '**/integrations/telegram/**',
        ],
        'Services are framework-free and channel-agnostic: no React, no UI, no Dexie, no Telegram.',
      ),
    },
  },

  {
    files: ['src/services/telegramService.ts'],
    rules: {
      ...forbid(
        [...UI_PACKAGES, 'dexie', 'dexie-react-hooks'],
        [
          '@/components/**',
          '@/features/**',
          '@/app/**',
          '@/hooks/**',
          '@/store/**',
          '@/db/**',
          '**/db',
          '**/db/**',
        ],
        'The Telegram adapter is still a service: no React, no UI, no Dexie.',
      ),
    },
  },

  // ----------------------------------------------------- layer 4: persistence
  {
    files: ['src/repositories/**/*.ts'],
    rules: { ...NO_REACT },
  },
  {
    files: ['src/db/**/*.ts'],
    rules: {
      ...forbid(
        ['react', 'react-dom', 'zustand'],
        [
          '@/components/**',
          '@/features/**',
          '@/app/**',
          '@/hooks/**',
          '@/store/**',
          '@/services/**',
          '**/services',
          '**/services/**',
          '@/repositories/**',
          '**/repositories',
          '**/repositories/**',
        ],
        'db/ is the bottom of the stack and depends on nothing above it.',
      ),
    },
  },

  // ------------------------------------------ layer 5: platform + integrations
  {
    files: ['src/platform/**/*.ts'],
    rules: { ...NO_REACT },
  },
  {
    files: ['src/integrations/**/*.ts'],
    rules: {
      ...forbid(
        ['react', 'react-dom', 'dexie'],
        [
          '@/components/**',
          '@/features/**',
          '@/app/**',
          '@/platform/**',
          '**/platform',
          '**/platform/**',
          '@/repositories/**',
          '**/repositories',
          '**/repositories/**',
          '@/db/**',
          '**/db',
          '**/db/**',
        ],
        'Integrations are pure transforms: no I/O, no persistence, no React.',
      ),
    },
  },

  // ------------------------------------------------------------ leaf modules
  {
    files: ['src/lib/**/*.ts', 'src/types/**/*.ts'],
    rules: {
      ...forbid(
        ['react', 'react-dom', 'dexie', 'zustand'],
        [
          '@/components/**',
          '@/features/**',
          '@/app/**',
          '@/services/**',
          '@/repositories/**',
          '@/db/**',
          '@/platform/**',
        ],
        'lib/ and types/ are leaves: they may not import from any other layer.',
      ),
    },
  },

  // ------------------------------------------------------------------- tests
  // A test is allowed to reach into any layer: asserting that a repository
  // wrote the right row, or that a screen is wired to a service, is the whole
  // job. Both rule names have to be switched off — the layer configs above use
  // the typescript-eslint variant, and turning off only the base rule leaves
  // that one active.
  {
    files: ['tests/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-restricted-imports': 'off' },
  },
)
