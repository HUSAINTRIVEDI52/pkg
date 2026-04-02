import js from '@eslint/js';

// Conditionally load typescript-eslint packages for TS support
let tsParser, tsPlugin;
try {
  const parserMod = await import('@typescript-eslint/parser');
  tsParser = parserMod.default || parserMod;
  
  const pluginMod = await import('@typescript-eslint/eslint-plugin');
  tsPlugin = pluginMod.default || pluginMod;
} catch (e) {
  // Not installed, proceed without TS support
}

const config = [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        // Node.js globals
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        fetch: 'readonly',
        // React
        React: 'readonly',
      },
    },
    rules: {
      'no-console': 'error',
      'eqeqeq': 'error',
      'indent': ['error', 2],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    rules: {
      'no-unused-vars': ['warn', {
        varsIgnorePattern: '^React$|^_|^use[A-Z]|^[A-Z]',
        argsIgnorePattern: '^_',
      }],
    },
  },
  // Base configuration placeholder for TS files
  // Full Typescript configuration is optionally added at the end of this file 
  // if the @typescript-eslint plugins are installed.
  {
    files: ['**/*.test.{js,jsx,ts,tsx}', '**/*.spec.{js,jsx,ts,tsx}', '**/tests/**/*.{js,jsx,ts,tsx}', '**/__tests__/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
        vi: 'readonly',
      },
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**'],
  },
];

if (tsParser && tsPlugin) {
  config.push({
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        varsIgnorePattern: '^React$|^_|^use[A-Z]|^[A-Z]',
        argsIgnorePattern: '^_',
      }],
    },
  });
} else {
  config.push({
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-unused-vars': 'off',
    },
  });
}

export default config;