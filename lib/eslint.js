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
  
  // List of common ESLint config files (legacy and flat)
  const configFiles = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    '.eslintrc.json',
    '.eslintrc'
  ];

  let existingConfigFile = null;
  for (const file of configFiles) {
    if (await fs.pathExists(path.join(projectRoot, file))) {
      existingConfigFile = file;
      break;
    }
  }

  // Also check package.json
  const pkgPath = path.join(projectRoot, 'package.json');
  let hasPkgConfig = false;
  if (await fs.pathExists(pkgPath)) {
    const pkg = await fs.readJSON(pkgPath);
    if (pkg.eslintConfig) {
      hasPkgConfig = true;
    }
  }

  let hasConfig = !!existingConfigFile || hasPkgConfig;

  // Skip interactive initialization - we want automatic setup only
  const isPostInstall = process.env.npm_lifecycle_event === 'postinstall';
  const isTTY = false; // Force disable interactive mode

  if (isTTY && !isPostInstall && !hasConfig) {
    logInfo('Interactive environment detected — launching ESLint initializer...');
    try {
      const { execSync } = require('child_process');
      // npx eslint --init is the official interactive wizard
      execSync('npx eslint --init', { stdio: 'inherit' });
      
      // Re-check if a config was created
      for (const file of configFiles) {
        if (await fs.pathExists(path.join(projectRoot, file))) {
          logSuccess('ESLint initialized interactively. ✔');
          hasConfig = true;
          break;
        }
      }
    } catch {
      logInfo('Interactive initialization skipped or failed — falling back to automatic setup.');
    }
  }

  if (hasConfig) {
    // If TypeScript is detected but config doesn't have TypeScript support, update it
    if (hasTypeScript && existingConfigFile) {
      logInfo('TypeScript detected but existing config may not support TypeScript. Updating...');
      // Continue with config creation
    } else {
      logInfo('ESLint configuration already exists — skipping default template installation.');
      return;
    }
  } else if (!hasTypeScript) {
    // No config exists and no TypeScript - skip for now
    return;
  }

  // 1. Detect ESLint version
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
    // Ignore errors, assume modern
  }

  const templateFile = isLegacy ? '.eslintrc.json' : 'eslint.config.mjs';
  
  // If TypeScript is detected, use TypeScript-enabled templates
  const tsTemplateFile = isLegacy ? '.eslintrc.json' : 'eslint.config.mjs';
  const fullTemplatePath = path.resolve(__dirname, '../templates', tsTemplateFile);
  const targetPath = path.join(projectRoot, templateFile);

  logInfo(`Compulsory setup: creating default ${templateFile} (Legacy: ${isLegacy})...`);

  if (!await fs.pathExists(fullTemplatePath)) {
    logInfo(`${templateFile} template not found — skipping auto-configuration.`);
    return;
  }

  await fs.copy(fullTemplatePath, targetPath);
  logSuccess(`Created ${targetPath}`);

  // Cleanup: Remove redundant eslintConfig from package.json
  if (await fs.pathExists(pkgPath)) {
    const pkg = await fs.readJSON(pkgPath);
    if (pkg.eslintConfig) {
      delete pkg.eslintConfig;
      await fs.writeJSON(pkgPath, pkg, { spaces: 2 });
      logInfo('Removed redundant eslintConfig from package.json.');
    }
  }
};
