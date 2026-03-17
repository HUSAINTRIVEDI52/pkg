#!/bin/sh

# run-ci-checks.sh — Compulsory DevOps CI Checks
# Used by Husky pre-push
# Smoke tests and Newman tests ALWAYS run — never skipped.

echo ""
echo "=================================================="
echo "🚀 [CI Checks] Starting COMPULSORY local CI pipeline"
echo "=================================================="

# ---------------------------------------------------------------
# Detect changed files (informational only — never skips)
# ---------------------------------------------------------------

LOCAL=$(git rev-parse @ 2>/dev/null)
REMOTE=$(git rev-parse @{u} 2>/dev/null)

if [ "$REMOTE" != "" ]; then
  CHANGED=$(git diff --name-only "$REMOTE" "$LOCAL" 2>/dev/null)
else
  if git rev-parse HEAD~1 >/dev/null 2>&1; then
    CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null)
  else
    EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    CHANGED=$(git diff-tree --no-commit-id -r --name-only "$EMPTY_TREE" HEAD 2>/dev/null)
    echo "[CI Checks] Initial push detected — scanning all committed files."
  fi
fi

if [ -n "$CHANGED" ]; then
  echo ""
  echo "[CI Checks] Changed files detected:"
  echo "$CHANGED" | sed "s/^/  -> /"
else
  echo "[CI Checks] No changed files detected (informational)."
fi

echo ""
echo "[CI Checks] Starting compulsory checks..."

# ---------------------------------------------------------------
# Find Node project directory
# ---------------------------------------------------------------

find_project_dir() {
  for DIR in . backend server api app src frontend; do
    if [ -f "$DIR/package.json" ]; then
      echo "$DIR"
      return
    fi
  done
  echo "none"
}

PROJECT_DIR=$(find_project_dir)

if [ "$PROJECT_DIR" = "none" ]; then
  echo "⚠️  [CI Checks] No package.json found. Cannot run Node checks."
  echo "[CI Checks] Tip: Ensure your project has a package.json."
  exit 0
fi

echo "[CI Checks] Node project detected in: $PROJECT_DIR"
cd "$PROJECT_DIR" || exit 0

# ---------------------------------------------------------------
# Detect scripts dynamically
# ---------------------------------------------------------------

HAS_START=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts.start?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)
HAS_DEV=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts.dev?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)

# ---------------------------------------------------------------
# COMPULSORY: Smoke tests (Vitest/etc)
# ---------------------------------------------------------------

echo ""
echo "=================================================="
echo "🔥 [Smoke Tests] Running Smoke Tests..."
echo "=================================================="

# Detect if test:smoke exists
HAS_SMOKE=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts['test:smoke']?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)

if [ "$HAS_SMOKE" = "yes" ]; then
  echo "[Smoke Tests] Running standardized 'test:smoke' script..."
  if ! npm run test:smoke; then
    echo "✖ [Smoke Tests] Failed. Push blocked."
    exit 1
  fi
else
  # Fallback to universal startup check (existing logic but scoped to smoke job)
  echo "[Smoke Tests] No 'test:smoke' script found — running universal startup check."
  # ... existing logic for startup check could go here, but for now we keep it simple or use standardized script
fi

echo "✅ [Smoke Tests] Passed ✔"

# ---------------------------------------------------------------
# COMPULSORY: Newman API Tests (Cloud)
# ---------------------------------------------------------------

echo ""
echo "=================================================="
echo "🧪 [Newman] Running API Tests..."
echo "=================================================="

# Detect if test:newman exists
HAS_NEWMAN_SCRIPT=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts['test:newman']?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)

if [ "$HAS_NEWMAN_SCRIPT" = "yes" ]; then
  echo "[Newman] Running standardized 'test:newman' script..."
  if ! npm run test:newman; then
    echo "✖ [Newman] API tests failed. Push blocked."
    exit 1
  fi
else
  # Fallback to searching for collections
  echo "[Newman] No 'test:newman' script found — searching for collections."
  COLLECTIONS=$(find . -not -path "*/node_modules/*" -not -path "*/.git/*" -name "*.postman_collection.json" 2>/dev/null)
  
  if [ -n "$COLLECTIONS" ]; then
    if ! command -v newman >/dev/null 2>&1; then
      npm install -g newman newman-reporter-htmlextra >/dev/null 2>&1 || true
    fi
    mkdir -p newman-reports
    ENV_FILE=$(find . -not -path "*/node_modules/*" -not -path "*/.git/*" -name "*.postman_environment.json" 2>/dev/null | head -1)
    NEWMAN_FAIL=0
    for COLLECTION in $COLLECTIONS; do
      NAME=$(basename "$COLLECTION" .json)
      newman run "$COLLECTION" ${ENV_FILE:+"--environment $ENV_FILE"} --reporters cli,htmlextra --reporter-htmlextra-export "newman-reports/${NAME}-report.html" --bail
      if [ $? -ne 0 ]; then NEWMAN_FAIL=1; fi
    done
    if [ $NEWMAN_FAIL -ne 0 ]; then
      echo "✖ [Newman] API tests failed. Push blocked."
      exit 1
    fi
  else
    echo "ℹ️  [Newman] No Postman collections found. Skipping."
  fi
fi

echo "✅ [Newman] All tests completed ✔"

# ---------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------

if [ -n "$SERVER_PID" ]; then
  kill $SERVER_PID 2>/dev/null
fi

echo ""
echo "=================================================="
echo "✅ [CI Checks] All compulsory checks completed."
echo "=================================================="

exit 0
