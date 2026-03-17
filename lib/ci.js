'use strict';

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const { logInfo, logSuccess, logError } = require('./logger');

const TEMPLATE_PATH = path.resolve(__dirname, '../templates/ci-tests.yml');
const CI_SCRIPT_TEMPLATE = path.resolve(__dirname, '../templates/run-ci-checks.sh');

exports.setupCIScript = async (gitRoot) => {
  const scriptsDir = path.join(gitRoot, 'scripts');
  const scriptPath = path.join(scriptsDir, 'run-ci-checks.sh');

  await fs.ensureDir(scriptsDir);

  if (await fs.pathExists(scriptPath)) {
    logInfo("run-ci-checks.sh already exists — overwriting with latest version.");
  } else {
    logInfo("Creating scripts/run-ci-checks.sh...");
  }

  // Read from template file instead of building strings
  // This avoids ALL quote escaping issues (JS -> SH -> Node multi-layer quoting)
  if (!await fs.pathExists(CI_SCRIPT_TEMPLATE)) {
    logError("CI script template not found. Please reinstall the package.");
    return;
  }
  // Guard: skip if source and destination are the same file (running in cs-setup's own dir)
  if (path.resolve(CI_SCRIPT_TEMPLATE) === path.resolve(scriptPath)) {
    logInfo("CI script template and destination are the same — skipping copy.");
    return;
  }

  await fs.copy(CI_SCRIPT_TEMPLATE, scriptPath);
  await fs.chmod(scriptPath, 0o755);
  logSuccess("scripts/run-ci-checks.sh created.");

  // NEW: Copy the Newman Cloud test template to tests/run-newman-cloud.js
  const newmanTemplate = path.resolve(__dirname, '../templates/run-newman-cloud.js.template');
  const testsDir = path.join(gitRoot, 'tests');
  const newmanTarget = path.join(testsDir, 'run-newman-cloud.js');

  if (fs.existsSync(newmanTemplate)) {
    await fs.ensureDir(testsDir);
    if (!fs.existsSync(newmanTarget)) {
      await fs.copy(newmanTemplate, newmanTarget);
      logSuccess("tests/run-newman-cloud.js created from template.");
    }
  }

  logInfo("To move tests to pre-commit in future: add './scripts/run-ci-checks.sh' to .husky/pre-commit.");
};

exports.setupPrePushHook = async (gitRoot) => {
  const huskyDir = path.join(gitRoot, '.husky');
  const hookPath = path.join(huskyDir, 'pre-push');

  if (!await fs.pathExists(huskyDir)) {
    logInfo("Husky directory not found. Skipping pre-push hook setup.");
    return;
  }

  const projectDir = path.relative(gitRoot, process.cwd()) || '.';

  if (await fs.pathExists(hookPath)) {
    logInfo("Pre-push hook already configured. Overwriting with latest setup...");
  } else {
    logInfo("Creating new pre-push hook...");
  }

  await fs.writeFile(hookPath, buildPrePushHook(projectDir));
  await fs.chmod(hookPath, 0o755);
  logSuccess("Pre-push hook created — calls scripts/run-ci-checks.sh.");
};

exports.setupCIWorkflow = async () => {
  const targetDir = path.join(process.cwd(), '.github', 'workflows');
  const targetFile = path.join(targetDir, 'ci-tests.yml');

  if (!await fs.pathExists(TEMPLATE_PATH)) {
    logError("CI template not found. Please reinstall the package.");
    return;
  }

  await fs.ensureDir(targetDir);

  if (await fs.pathExists(targetFile)) {
    logInfo("ci-tests.yml already exists — overwriting with latest version.");
  } else {
    logInfo("Creating .github/workflows/ci-tests.yml...");
  }

  await fs.copy(TEMPLATE_PATH, targetFile);
  logInfo("GitHub Actions template available, but setup is disabled by default (favoring pre-push).");
};

exports.ensureProjectScripts = async () => {
  const pkgPath = path.join(process.cwd(), 'package.json');

  if (!await fs.pathExists(pkgPath)) {
    logError("No package.json found. Skipping script standardization.");
    return;
  }

  const { readJSON, writeJSON } = require('./utils');
  const pkg = await readJSON(pkgPath);
  if (!pkg.scripts) pkg.scripts = {};
  let changed = false;

  // 1. Standardize "test" script
  const currentTest = pkg.scripts.test || '';
  if (!currentTest || currentTest.includes('no test specified')) {
    const isVite = pkg.dependencies?.vite || pkg.devDependencies?.vite;
    pkg.scripts.test = isVite ? 'vitest run' : 'node --test';
    logInfo(`Standardizing "test" script -> ${pkg.scripts.test}`);
    changed = true;
  }

  // 2. Add 'test:smoke' and 'test:newman' if they look like they're needed
  if (!pkg.scripts['test:smoke']) {
    const isVite = pkg.dependencies?.vite || pkg.devDependencies?.vite || pkg.devDependencies?.vitest;
    pkg.scripts['test:smoke'] = isVite ? 'vitest run' : (pkg.scripts.test || 'node --test');
    logInfo(`Creating "test:smoke" script -> ${pkg.scripts['test:smoke']}`);
    changed = true;
  }

  if (!pkg.scripts['test:newman']) {
    // Default to the new cloud runner if it exists, otherwise use basic newman
    if (fs.existsSync(path.join(process.cwd(), 'tests', 'run-newman-cloud.js'))) {
        pkg.scripts['test:newman'] = 'node tests/run-newman-cloud.js';
    } else {
        pkg.scripts['test:newman'] = 'newman run *.postman_collection.json --bail';
    }
    logInfo(`Creating "test:newman" script -> ${pkg.scripts['test:newman']}`);
    changed = true;
  }

  // 3. Ensure 'test:all' script
  if (!pkg.scripts['test:all']) {
    pkg.scripts['test:all'] = 'npm run test:smoke && npm run test:newman';
    logInfo('Creating "test:all" script.');
    changed = true;
  }

  // 4. Ensure 'check-hooks' is run before tests and start
  // This is the core of our "Bulletproof" auto-healing
  // We use npx --no-install and suppress errors to keep it silent and registry-safe.
  const checkCmd = 'npx --no-install cs-setup check-hooks 2>/dev/null || true && ';
  ['test', 'start'].forEach(s => {
    if (pkg.scripts[s] && !pkg.scripts[s].includes('cs-setup check-hooks')) {
      pkg.scripts[s] = checkCmd + pkg.scripts[s];
      changed = true;
    }
  });

  if (!pkg.scripts.start) {
    const startGuess = pkg.scripts.backend || pkg.scripts.server || pkg.scripts.api || pkg.scripts.dev;
    if (startGuess) {
      pkg.scripts.start = pkg.scripts[startGuess];
      logInfo(`Mapping "start" script to "${startGuess}"`);
      changed = true;
    } else {
      if (await fs.pathExists('index.js')) {
        pkg.scripts.start = 'node index.js';
        changed = true;
      } else if (await fs.pathExists('server.js')) {
        pkg.scripts.start = 'node server.js';
        changed = true;
      }
    }
  }

  if (changed) {
    await writeJSON(pkgPath, pkg);
    logSuccess("package.json scripts standardized.");
  }
};

exports.ensurePackageLock = async () => {
  const lockPath = path.join(process.cwd(), 'package-lock.json');
  const yarnPath = path.join(process.cwd(), 'yarn.lock');

  if (await fs.pathExists(lockPath) || await fs.pathExists(yarnPath)) {
    logSuccess("Lock file found (package-lock.json / yarn.lock).");
    return;
  }

  logInfo("No package-lock.json found — running npm install to generate it...");
  try {
    execSync('npm install', { stdio: 'inherit', cwd: process.cwd() });
    logSuccess("package-lock.json generated. Remember to commit it.");
  } catch {
    logError("Failed to generate package-lock.json. Run npm install manually.");
  }
};

function buildPrePushHook(projectDir) {
  const cdLine = projectDir !== '.' ? `cd "${projectDir}"` : '';

  // Read the CI script template at build time and embed it in the hook
  let ciScriptContent = '';
  try {
    ciScriptContent = fs.readFileSync(CI_SCRIPT_TEMPLATE, 'utf8');
  } catch {
    logError('CI script template not found — pre-push will skip checks if script is missing.');
  }

  // Escape any single quotes in the template for the heredoc
  const escapedCiScript = ciScriptContent.replace(/'/g, "'\\''");

  return `#!/bin/sh

${cdLine ? cdLine + '\n' : ''}

# ---------------------------------------------------------------
# Self-contained CI script restoration
# If scripts/run-ci-checks.sh is missing, create it inline
# (no external binary needed)
# ---------------------------------------------------------------
if [ ! -f "./scripts/run-ci-checks.sh" ]; then
  echo "⚠️  [Pre-push] CI script missing. Auto-creating from embedded template..."
  mkdir -p ./scripts
  cat > ./scripts/run-ci-checks.sh << 'CISCRIPT_EOF'
${ciScriptContent}
CISCRIPT_EOF
  chmod +x ./scripts/run-ci-checks.sh
  if [ -f "./scripts/run-ci-checks.sh" ]; then
    echo "✅ [Pre-push] CI script restored successfully."
  else
    echo "❌ [Pre-push] Failed to create CI script. Skipping checks."
    exit 0
  fi
fi

./scripts/run-ci-checks.sh
`;
}
