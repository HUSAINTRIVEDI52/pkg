'use strict';

const fs = require('fs-extra');
const path = require('path');
const { logInfo, logSuccess } = require('./logger');

/**
 * checkForTypeScript(projectRoot)
 *
 * Checks if the project uses TypeScript by looking for:
 * - tsconfig.json file
 * - .ts/.tsx files in the project
 */
async function checkForTypeScript(projectRoot) {
  // Check for tsconfig.json
  if (await fs.pathExists(path.join(projectRoot, 'tsconfig.json'))) {
    return true;
  }

  // Check for TypeScript files in common directories
  const searchDirs = ['src', 'lib', 'app', 'components', 'pages', 'utils'];

  for (const dir of searchDirs) {
    const dirPath = path.join(projectRoot, dir);
    if (await fs.pathExists(dirPath)) {
      try {
        const files = await fs.readdir(dirPath);
        const hasTsFiles = files.some(file =>
          file.endsWith('.ts') || file.endsWith('.tsx')
        );
        if (hasTsFiles) return true;
      } catch {
        // Ignore directory read errors
      }
    }
  }

  // Check root directory for TypeScript files
  try {
    const rootFiles = await fs.readdir(projectRoot);
    return rootFiles.some(file =>
      file.endsWith('.ts') || file.endsWith('.tsx')
    );
  } catch {
    return false;
  }
}

/**
 * setupESLintConfig()
 * Checks if an ESLint configuration exists. If not, creates a default one.
 * If one exists, merges only the required settings (root:true + .mjs override).
 * Works for both JavaScript-only and TypeScript projects.
 */
exports.setupESLintConfig = async () => {
  const projectRoot = process.cwd();

  // Check if TypeScript is used in the project
  const hasTypeScript = await checkForTypeScript(projectRoot);

  // Install TypeScript ESLint dependencies if TypeScript is detected
  if (hasTypeScript) {
    const { installDevDependency } = require('./packageManager');
    logInfo('TypeScript files detected. Installing TypeScript ESLint dependencies...');
    await installDevDependency('@typescript-eslint/parser');
    await installDevDependency('@typescript-eslint/eslint-plugin');
    await installDevDependency('typescript');
  }

  // List of common ESLint config files (flat config v9+ and legacy)
  const configFiles = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    '.eslintrc.json',
    '.eslintrc',
  ];

  let existingConfigFile = null;
  for (const file of configFiles) {
    if (await fs.pathExists(path.join(projectRoot, file))) {
      existingConfigFile = file;
      break;
    }
  }

  // Also check package.json for eslintConfig field
  const pkgPath = path.join(projectRoot, 'package.json');
  let hasPkgConfig = false;
  if (await fs.pathExists(pkgPath)) {
    const pkg = await fs.readJSON(pkgPath);
    if (pkg.eslintConfig) {
      hasPkgConfig = true;
    }
  }

  const hasConfig = !!existingConfigFile || hasPkgConfig;

  if (hasConfig) {
    logInfo(`ESLint config found (${existingConfigFile || 'package.json'}) — merging required settings...`);

    // Only merge into .eslintrc.json (legacy format) — flat configs manage themselves
    if (existingConfigFile === '.eslintrc.json') {
      const targetPath = path.join(projectRoot, '.eslintrc.json');
      try {
        const config = await fs.readJSON(targetPath);
        let changed = false;

        // 1. Add root:true to stop global ~/.eslintrc.* interference
        if (!config.root) {
          config.root = true;
          changed = true;
        }

        // 2. Add .mjs override if not already present
        if (!config.overrides) config.overrides = [];
        const hasMjsOverride = config.overrides.some(o =>
          Array.isArray(o.files) && o.files.includes('*.mjs')
        );
        if (!hasMjsOverride) {
          config.overrides.push({
            files: ['*.mjs'],
            parserOptions: {
              sourceType: 'module',
              ecmaVersion: 'latest'
            }
          });
          changed = true;
        }

        if (changed) {
          await fs.writeJSON(targetPath, config, { spaces: 2 });
          logSuccess('ESLint config updated — added root:true and .mjs override.');
        } else {
          logInfo('ESLint config already up to date — no changes needed.');
        }
      } catch {
        logInfo('Could not merge into existing .eslintrc.json — skipping.');
      }
    } else {
      logInfo(`Existing config is ${existingConfigFile} — skipping merge (not .eslintrc.json).`);
    }

    return;
  }

  // ── No config found — create one automatically ──────────────────────────────
  // Detect ESLint version to decide flat config (v9+) vs legacy (.eslintrc)
  let isLegacy = false;
  try {
    const eslintPkgPath = path.join(projectRoot, 'node_modules', 'eslint', 'package.json');
    if (await fs.pathExists(eslintPkgPath)) {
      const eslintPkg = await fs.readJSON(eslintPkgPath);
      const version = parseInt(eslintPkg.version.split('.')[0], 10);
      if (version < 9) {
        isLegacy = true;
      }
    }
  } catch {
    // Ignore errors, assume modern ESLint (v9+)
  }

  const templateFile = isLegacy ? '.eslintrc.json' : 'eslint.config.mjs';
  const fullTemplatePath = path.resolve(__dirname, '../templates', templateFile);
  const targetPath = path.join(projectRoot, templateFile);

  logInfo(`Creating default ESLint config: ${templateFile} (TypeScript: ${hasTypeScript}, Legacy: ${isLegacy})...`);

  if (!await fs.pathExists(fullTemplatePath)) {
    logInfo(`${templateFile} template not found — skipping auto-configuration.`);
    return;
  }

  await fs.copy(fullTemplatePath, targetPath);
  logSuccess(`ESLint config created: ${targetPath}`);

  // If TypeScript detected AND legacy mode: extend .eslintrc.json with TS support
  if (hasTypeScript && isLegacy) {
    try {
      const config = await fs.readJSON(targetPath);
      config.parser = '@typescript-eslint/parser';
      if (!config.extends) config.extends = ['eslint:recommended'];
      if (!config.extends.includes('@typescript-eslint/recommended')) {
        config.extends.push('@typescript-eslint/recommended');
      }
      if (!config.plugins) config.plugins = [];
      if (!config.plugins.includes('@typescript-eslint')) {
        config.plugins.push('@typescript-eslint');
      }
      if (!config.rules) config.rules = {};
      config.rules['no-unused-vars'] = 'off';
      config.rules['@typescript-eslint/no-unused-vars'] = ['warn', {
        varsIgnorePattern: '^React$',
        argsIgnorePattern: '^_',
      }];
      await fs.writeJSON(targetPath, config, { spaces: 2 });
      logInfo('Added TypeScript support to .eslintrc.json.');
    } catch {
      logInfo('Could not extend .eslintrc.json with TypeScript config — using JS-only defaults.');
    }
  }

  // Cleanup: Remove redundant eslintConfig from package.json if it exists
  if (hasPkgConfig && await fs.pathExists(pkgPath)) {
    const pkg = await fs.readJSON(pkgPath);
    if (pkg.eslintConfig) {
      delete pkg.eslintConfig;
      await fs.writeJSON(pkgPath, pkg, { spaces: 2 });
      logInfo('Removed redundant eslintConfig from package.json.');
    }
  }
};