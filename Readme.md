# cs-setup

A robust, zero-config CLI package that automatically secures and standardizes your projects. By simply installing this package, it automatically configures **Husky**, **Gitleaks**, **ESLint**, **SonarQube**, **Smoke Testing**, and **Newman API Testing** natively hooked into your Git workflow.

---

## 🚀 Features

### 🛡️ Pre-Commit Hook (Code Quality & Security)
Whenever you run `git commit`, the following checks run automatically on your staged files:
1. **ESLint**: Auto-lints all staged `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs` files. If you don't have ESLint configured, it will set up a compulsory auto-configuration for you.
2. **Gitleaks**: Scans staged files for hardcoded secrets, API keys, and credentials using a native binary. **Blocks the commit** if any secrets are detected.
3. **Coverage & SonarQube**: Attempts to generate test coverage (via Jest/Vitest) and then runs a SonarQube scan. If the SonarQube Quality Gate fails, the **commit is blocked**.

### 🧪 Pre-Push Hook (CI Pipeline)
Whenever you run `git push`, a compulsory local CI pipeline runs:
1. **Smoke Test**: Automatically detects your project, finds your `start` or `dev` script, boots up your server, dynamically detects the port (from `.env`, `package.json`, or source code), and waits for it to be accessible.
2. **Newman API Tests**: Automatically searches for Postman collections (`*.postman_collection.json`) in your project and runs Newman API tests against your locally running server. **Blocks the push** if any tests fail.

---

## 📦 Installation

To install and initialize the setup in your project, simply add it as a `devDependency` in your `package.json`:

```json
{
  "devDependencies": {
    "cs-setup": "github:HUSAINTRIVEDI52/pkg#m-main"
  }
}
```

Then, run:
```bash
npm install
```

### What happens during install?
The `postinstall` script runs automatically and will:
- Install Husky and initialize the Git hooks (`.husky/`).
- Download and set up Gitleaks natively.
- Install SonarQube Scanner.
- Install ESLint and `@eslint/js` (if not present).
- Create a `sonar-project.properties` template.
- Inject standardized test scripts into your `package.json` (`test:smoke`, `test:newman`, `test:all`).
- Guard your `start` and `test` scripts to always ensure hooks are correctly installed (`check-hooks`).

---

## ⚙️ Manual Initialization

If the automatic setup didn't trigger, or if you want to re-run the initialization:

```bash
npx cs-setup init
```

To just verify and restore your hooks without a full initialization:
```bash
npx cs-setup check-hooks
```

---

## 📋 Configuration Details

### SonarQube
A `sonar-project.properties` file is generated in your project root. You **must** edit this file to provide your SonarQube credentials to allow the scan to pass:
- `sonar.host.url`: Your SonarQube server URL.
- `sonar.login`: Your SonarQube token.

### Postman / Newman
For the pre-push hook to run Newman tests, simply save your Postman collections in your repository with the `.postman_collection.json` extension. If you have an environment file, name it `*.postman_environment.json`. The CI script will automatically find and execute them.

### Monorepo Support
The package automatically detects if your Node project is in a subdirectory of the Git repository. The hooks will automatically `cd` into the correct project folder before running checks.

---

## ❌ Troubleshooting

- **Hooks aren't running?** Ensure you have initialized a Git repository (`git init`) before installing the package. You can manually run `npx cs-setup init` to retry.
- **Server fails to start in CI?** Ensure your `package.json` has a valid `start` or `dev` script. The setup detects common ports, but explicitly setting `PORT=` in your `.env` is recommended.



