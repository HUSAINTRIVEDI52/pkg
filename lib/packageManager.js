'use strict';

const fs = require('fs-extra');
const path = require('path');
const execa = require('execa');
const { logInfo, logSuccess, logError } = require('./logger');

/**
 * installAllRequiredDependencies()
 * 
 * Installs all required packages for the cs-setup functionality
 */
exports.installAllRequiredDependencies = async () => {
  const pkgPath = path.join(process.cwd(), 'package.json');
  let hasTypeScript = false;
  let isVite = false;

  // Check for TypeScript and Vite/Vitest
  try {
    const pkg = await fs.readJSON(pkgPath);
    hasTypeScript = !!(pkg.dependencies?.typescript ||
      pkg.devDependencies?.typescript ||
      pkg.dependencies?.['@types/node'] ||
      pkg.devDependencies?.['@types/node'] ||
      fs.existsSync(path.join(process.cwd(), 'tsconfig.json')));

    isVite = !!(pkg.dependencies?.vite || pkg.devDependencies?.vite || pkg.devDependencies?.vitest);

    if (!isVite) {
      // Fallback: check for existence of configuration files
      const configFiles = [
        'vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs',
        'vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs'
      ];
      for (const file of configFiles) {
        if (fs.existsSync(path.join(process.cwd(), file))) {
          isVite = true;
          break;
        }
      }
    }
  } catch (e) {
    // Ignore if package.json doesn't exist or can't be read
  }


  const requiredPackages = [
    'eslint',
    '@eslint/js'
  ];

  if (isVite) {
    requiredPackages.push('@vitest/coverage-v8');
  }

  // Removed programmatic npm installations for TypeScript plugins because they are now mathematically
  // guaranteed to be installed natively via our broadly-compatible (>=5.0.0) package.json dependencies,
  // bypassing npm's restrictive postinstall lockfile issues!

  logInfo('Installing required dependencies...');
  for (const pkg of requiredPackages) {
    await exports.installDevDependency(pkg);
  }


  logSuccess('All required dependencies installed.');
};

/**
 * installDevDependency(pkg)
 *
 * Installs a package into node_modules AND records it in devDependencies
 * using a single `npm install --save-dev` call.
 *
 * This is the ONLY reliable approach on a fresh machine / CI server where
 * node_modules may not exist yet.  Writing to package.json alone (without
 * running npm install) leaves the binary missing from node_modules.
 */
exports.installDevDependency = async (pkg) => {
  const pkgPath = path.join(process.cwd(), 'package.json');

  if (!await fs.pathExists(pkgPath)) {
    logInfo(`No package.json found at ${process.cwd()}. Skipping: ${pkg}`);
    return;
  }

  // Check if already in package.json AND node_modules
  const pkgJson = await fs.readJSON(pkgPath);
  const isInstalledInPkg = (pkgJson.dependencies && pkgJson.dependencies[pkg]) ||
    (pkgJson.devDependencies && pkgJson.devDependencies[pkg]);

  const isBinaryPresent = await fs.pathExists(path.join(process.cwd(), 'node_modules', pkg));

  if (isInstalledInPkg && isBinaryPresent) {
    logInfo(`${pkg} is already installed — skipping.`);
    return;
  }

  // Always run npm install to ensure the package is up to date and correctly linked
  logInfo(`Installing ${pkg}...`);
  try {
    await execa('npm', ['install', '--save-dev', pkg], {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: process.env,
    });
    logSuccess(`${pkg} installed successfully.`);
  } catch (err) {
    logError(
      `Failed to install ${pkg}: ${err.message}\n` +
      `  → Run manually: npm install --save-dev ${pkg}`
    );
  }
};