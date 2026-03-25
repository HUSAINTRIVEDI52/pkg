import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    rules: {
      'no-console': 'warn',
      'eqeqeq': 'error',
      'indent': ['error', 2],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
];