import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const browserGlobals = {
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  window: 'readonly',
  module: 'readonly'
};
const pluginRules = {
  ...js.configs.recommended.rules,
  curly: ['error', 'all'],
  'one-var': ['error', 'never'],
  'no-return-assign': 'error',
  'no-sequences': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-throw-literal': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }]
};

export default [
  {
    files: ['web/plugin/**/*.js', 'web/static/kp.js'],
    languageOptions: {
      ecmaVersion: 2015,
      sourceType: 'module',
      globals: browserGlobals
    },
    rules: pluginRules
  },
  {
    files: ['web/plugin/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true },
      globals: browserGlobals
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      ...pluginRules,
      ...tseslint.configs.recommended[2].rules,
      'no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-this-alias': ['error', { allowedNames: ['self'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', caughtErrors: 'none' }
      ]
    }
  },
  {
    files: ['web/static/kp.js'],
    // Parsing the actual shipped artifact as ES5 protects older TV engines.
    languageOptions: { ecmaVersion: 5, sourceType: 'script' }
  },
  {
    files: ['scripts/build-plugin.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { process: 'readonly', console: 'readonly' }
    },
    rules: js.configs.recommended.rules
  }
];
