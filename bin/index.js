#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// STEP 0 — Self-install own dependencies using ONLY Node.js built-ins.
//
// When installed via `npm install /local/path` or `npm install github:user/repo`,
// npm does NOT guarantee our own node_modules exists before running postinstall.
// We must bootstrap ourselves using only fs, path, child_process (always available).
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const PKG_DIR = path.resolve(__dirname, '..');          // our package root
const OWN_NODE_MODULES = path.join(PKG_DIR, 'node_modules');
const SENTINEL = path.join(OWN_NODE_MODULES, 'fs-extra', 'package.json');

if (!fs.existsSync(SENTINEL)) {
  // GUARD: If we are already in a postinstall/install lifecycle, skip self-install.
  // Running a package manager inside another package manager's lifecycle is dangerous (locks, corruption).
  const isLifecycle = process.env.npm_lifecycle_event || process.env.npm_config_argv;
  if (isLifecycle && isLifecycle.includes('install')) {
    console.warn('[cs-setup] Dependencies missing, but skipping self-install during lifecycle to avoid lockfile conflicts.');
    console.warn('[cs-setup] If the script fails, please run: npm install (or pnpm/yarn install) manually.');
  } else {
    console.log('[cs-setup] Installing own dependencies first...');
    
    // Minimal detection for bootstrap phase
    let manager = 'npm';
    if (fs.existsSync(path.join(PKG_DIR, 'pnpm-lock.yaml'))) manager = 'pnpm';
    else if (fs.existsSync(path.join(PKG_DIR, 'yarn.lock'))) manager = 'yarn';
    else if (fs.existsSync(path.join(PKG_DIR, 'bun.lockb'))) manager = 'bun';

    const installArgs = (manager === 'yarn' || manager === 'pnpm' || manager === 'bun') 
      ? ['install', '--ignore-scripts'] 
      : ['install', '--ignore-scripts', '--legacy-peer-deps'];

    const result = spawnSync(manager, installArgs, {
      cwd: PKG_DIR,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
      console.error(`[cs-setup] Failed to install own dependencies via ${manager}. Please run:`);
      console.error(`  cd ${PKG_DIR} && ${manager} install`);
      process.exit(0);
    }
    console.log('[cs-setup] Own dependencies installed.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Now safe to require our dependencies
// ─────────────────────────────────────────────────────────────────────────────
console.log('[cs-setup] Script starting...');

const { installHusky } = require('../lib/husky');
const { installGitleaks } = require('../lib/gitleaks');
const { installSonarScanner, setupSonarProperties } = require('../lib/sonarqube');
const { setupPreCommitHook } = require('../lib/hooks');
const { setupPrePushHook, setupCIScript,
  setupCIWorkflow, validateProject,
  ensurePackageLock } = require('../lib/ci');
const { isGitRepo } = require('../lib/git');
const { logInfo, logError, logSuccess } = require('../lib/logger');
const { fixInvalidAliases } = require('../lib/fixer');
const { setupESLintConfig } = require('../lib/eslint');
const { readJSON } = require('../lib/utils');

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Parse command and detect context
// ─────────────────────────────────────────────────────────────────────────────
const command = process.argv[2];
const validCommands = ['init', 'install', 'check-hooks'];

if (command && !validCommands.includes(command)) {
  console.log('Usage: cs-setup [init|install|check-hooks]');
  process.exit(0);
}

const isPostInstall = process.env.npm_lifecycle_event === 'postinstall';
const initCwd = process.env.INIT_CWD || process.env.npm_config_local_prefix;

if (isPostInstall) {
  console.log('\n\x1b[1m\x1b[34m[cs-setup] 🚀 Automatic setup starting...\x1b[0m');
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Guard: skip if npm is installing OUR OWN deps (nested postinstall)
//
// We want to run ONLY when the USER installs us.
// If process.cwd() is the SAME as initCwd, it means someone is running 
// 'npm install' inside the cs-setup folder itself (development) — skip.
// ─────────────────────────────────────────────────────────────────────────────
const currentDir = path.resolve(process.cwd());
let projectDir = initCwd ? path.resolve(initCwd) : null;

if (!projectDir) {
  // Attempt fallback: if we're in node_modules/cs-setup, projectDir is 2 levels up
  if (currentDir.includes('node_modules')) {
    const potentialProjectDir = path.resolve(currentDir, '..', '..');
    if (fs.existsSync(path.join(potentialProjectDir, 'package.json'))) {
      projectDir = potentialProjectDir;
    }
  }
}

// cd into the user's project if detected and different from current
if (projectDir && currentDir !== projectDir) {
  try {
    process.chdir(projectDir);
    logInfo(`Target project: ${projectDir}`);
  } catch (e) {
    logError(`Failed to switch to project directory: ${e.message}`);
    // Non-fatal, we continue in current dir
  }
}

if (isPostInstall) {
  const currentDir = path.resolve(process.cwd());
  // If we are developing (original cwd === target project), skip setup
  if (path.resolve(currentDir) === path.resolve(initCwd || '')) {
    console.log('[cs-setup] Development detected — skipping automatic setup.');
    process.exit(0);
  }
  
  if (!projectDir) {
    logError('Could not determine project directory. Run `npx cs-setup init` manually.');
    process.exit(0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Run the full setup
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const targetTool = process.argv[3]; // e.g. 'gitleaks'

    if (command === 'install' && targetTool === 'gitleaks') {
      await installGitleaks(gitRoot);
      process.exit(0);
    }

    const { found, gitRoot, projectRoot } = await isGitRepo();

    if (command === 'check-hooks') {
      if (!found) {
        logInfo('Not a git repository — skipping check-hooks.');
        process.exit(0);
      }

      logInfo('\x1b[1mChecking git hooks and configuration integrity...\x1b[0m');

      // Always re-run these to ensure hooks are up-to-date and configs are present
      await installHusky(gitRoot);
      await setupPreCommitHook(gitRoot);
      await setupPrePushHook(gitRoot);

      // Ensure tools are installed
      const { installSonarScanner } = require('../lib/sonarqube');
      const { installAllRequiredDependencies } = require('../lib/packageManager');
      await installSonarScanner();
      await installAllRequiredDependencies();

      await setupESLintConfig();
      await setupSonarProperties();
      
      // Setup CI script and Workflows
      await setupCIScript(projectRoot);
      await setupCIWorkflow(gitRoot);
      
      logSuccess('Git hooks and configuration verified/restored.');
      process.exit(0);
    }

    logInfo('cs-setup: Initializing secure git hooks...');

    // ─────────────────────────────────────────────────────────────────────────────
    // AUTO-FIX: Handle invalid npm aliases (e.g. rolldown-vite@7.2.2)
    // ─────────────────────────────────────────────────────────────────────────────
    await fixInvalidAliases();

    if (!found) {
      logError('Not inside a git repository — skipping setup.');
      logInfo('Run `git init` first, then: npx cs-setup init');
      process.exit(0);
    }

    if (gitRoot !== projectRoot) {
      logInfo(`Git root:     ${gitRoot}`);
      logInfo(`Project root: ${projectRoot}`);
      logInfo('Monorepo detected — hooks at git root, config files at project root.');
    }

    const { installAllRequiredDependencies } = require('../lib/packageManager');
    await installHusky(gitRoot);
    await installGitleaks(gitRoot);
    await installSonarScanner();
    
    // ─────────────────────────────────────────────────────────────────────────────
    // GUARD: Skip project modifications during automatic postinstall
    // ─────────────────────────────────────────────────────────────────────────────
    if (isPostInstall) {
      logInfo('Automatic post-install: skipping dependency installation to prevent lockfile conflicts.');
      logInfo('To complete the full setup (ESLint, Newman Cloud, etc.), please run:');
      logInfo('\x1b[1m  npx cs-setup init\x1b[0m');
    } else {
      // Install all required ESLint dependencies
      await installAllRequiredDependencies();

      // Setup ESLint with TypeScript support
      await setupESLintConfig();

      await setupSonarProperties();
      await setupPreCommitHook(gitRoot);
      logSuccess('Husky + Gitleaks + SonarQube pre-commit hook ready.');
      logInfo('Edit sonar-project.properties — set sonar.host.url and sonar.token.');

      await ensurePackageLock();
      await setupCIScript(projectRoot);
      await require('../lib/ci').ensureProjectScripts();
      
      await setupCIWorkflow(gitRoot);
      await setupPrePushHook(gitRoot);
      logSuccess('Pre-push hook ready.');
    }

  } catch (err) {
    logError(`cs-setup failed: ${err.message}`);
    process.exit(0);
  }
})();