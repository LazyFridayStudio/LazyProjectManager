import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Layers may only import downwards. `packages/domain` is the innermost layer and
 * holds pure business rules, so it may not reach for IO, HTTP or the database;
 * `packages/contracts` is the shared vocabulary and may not import anything at
 * all. ARCHITECTURE.md states these boundaries in prose — this encodes them so
 * CI catches the violation instead of a reviewer.
 */
const layerImportBoundaries = [
  {
    files: ['app/Shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@lpm/*'],
              message:
                'app/Shared is the vocabulary both sides import. It must depend on nothing else in the workspace.',
            },
          ],
        },
      ],
    },
  },
  {
    // The pure-rules layer inside the server. It is a folder rather than its own
    // package now, so this rule is what keeps the boundary real.
    files: ['app/Server/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@lpm/database',
                'pg',
                'kysely',
                'fastify',
                'ioredis',
                'bullmq',
                'node:fs',
                'node:net',
              ],
              message:
                'app/Server/src/domain holds pure business rules. Keeping it free of IO is what lets those rules be tested without a running stack.',
            },
            {
              group: ['**/cqrs/**', '**/modules/**', '**/server/**', '**/outbox/**'],
              message:
                'Business rules must not reach back up into the HTTP or database layers that call them.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['app/Client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@lpm/database', '@lpm/server'],
              message:
                'The browser talks to the server over the command/query contract. Import @lpm/shared only.',
            },
          ],
        },
      ],

      /*
       * The browser's own dialogs, which this product does not use.
       *
       * They block the whole tab, they cannot be styled, they print the page's
       * origin above the question, and their buttons read OK and Cancel
       * whatever is about to happen. `useDisplay` asks instead, and a rule is
       * here because the reason to reach for `window.confirm` is always that it
       * is one line — which is exactly how a product ends up asking the same
       * question four different ways.
       */
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'confirm',
          message: 'Ask with askToConfirm from useDisplay.',
        },
        {
          object: 'window',
          property: 'prompt',
          message: 'Ask with askForText from useDisplay.',
        },
        {
          object: 'window',
          property: 'alert',
          message: 'Say it with showError or showNotice from useDisplay.',
        },
      ],
    },
  },
];

/**
 * CleanCode.md is the naming and structure standard for this repository. These
 * rules cover the parts a linter can actually check; the rest is review.
 */
const cleanCodeRules = {
  // "Functions must keep argument counts low" — past three, group the values
  // into a named request object.
  'max-params': ['warn', 3],
  // "Functions must do one thing" — a function that needs more than this is
  // holding more than one responsibility.
  'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true }],
  complexity: ['warn', 12],
  'max-depth': ['warn', 3],

  // "Comments must not preserve dead code" and "must not add noise".
  'no-warning-comments': ['warn', { terms: ['fixme', 'xxx', 'hack'], location: 'start' }],

  // "Names must describe gameplay intent, not the variable type" — a name may
  // not be a bare type abbreviation, and single letters are banned outside the
  // tiny scopes where they are instantly obvious.
  // `pg` is the package's own name and cannot be renamed at the import site.
  'id-length': [
    'warn',
    { min: 3, exceptions: ['id', 'db', 'to', 'up', 'ok', 'pg', '_'], properties: 'never' },
  ],
  '@typescript-eslint/naming-convention': [
    'error',
    { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
    { selector: 'variable', format: ['camelCase', 'UPPER_CASE'], leadingUnderscore: 'allow' },
    { selector: 'typeLike', format: ['PascalCase'] },
    { selector: 'enumMember', format: ['PascalCase'] },
    { selector: 'objectLiteralProperty', format: null },
    { selector: 'typeProperty', format: null },
    { selector: 'import', format: ['camelCase', 'PascalCase'] },
  ],
};

export default defineConfig(
  {
    ignores: [
      // Everything generated lives here, and it is gitignored for the same
      // reason. A Playwright report left behind by a failing run put a bundle
      // of somebody else's JavaScript in front of the linter, so whether `pnpm
      // lint` passed depended on how the last e2e run ended.
      '.output/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      '**/dist-types/**',
      '**/.vite/**',
      'app/Client/dist/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // One lint-only program covering source, tests and config files. The
        // per-package build tsconfigs deliberately exclude tests, so pointing
        // type-aware rules at those would leave every test file unparsed.
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      ...cleanCodeRules,

      // An unused variable is either a leftover or a mistake. Prefix with _ to
      // state that it is deliberately ignored.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Type-only imports are erased at build time. Marking them keeps the
      // emitted JavaScript free of imports that exist purely for types.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // "Functions must not return error codes" — throw a typed error instead.
      '@typescript-eslint/only-throw-error': 'error',

      // Floating promises are the most common source of silent failure in a
      // Fastify handler or a BullMQ worker.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  ...layerImportBoundaries,

  {
    // React components are PascalCase functions, and JSX files carry the DOM
    // globals the Node-only default config does not.
    files: ['**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      /**
       * The 60-line limit measures logic density, and a component's return is
       * declarative markup rather than logic — a form of five fields is one
       * responsibility however many lines its JSX takes. Splitting it to satisfy
       * a line count produces components that exist only to be short, which is
       * the opposite of what `CleanCode.md` asks for. The ceiling still catches
       * a component that has genuinely grown into a screen.
       */
      'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'variable', format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'typeProperty', format: null },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
    },
  },

  {
    files: ['app/Client/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', 'app/Client/e2e/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    // Build and lint configuration. Several of these tools ship no types, so
    // the unsafe-* family reports on their untyped exports rather than on
    // anything we wrote. Boundary rules do not apply to config either.
    files: ['config/*.config.{js,ts}', '**/*.config.{ts,js,mts}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  prettierConfig,
);
