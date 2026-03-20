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
# COMPULSORY: Smoke tests (Jest/Vitest/etc) — no server needed
# ---------------------------------------------------------------

echo ""
echo "=================================================="
echo "🔥 [Smoke Tests] Running Smoke Tests..."
echo "=================================================="

HAS_SMOKE=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts['test:smoke']?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)
if [ "$HAS_SMOKE" = "yes" ]; then
  echo "[Smoke Tests] Running standardized 'test:smoke' script..."
  if ! npm run test:smoke; then
    echo "✖ [Smoke Tests] Failed. Push blocked."
    exit 1
  fi
else
  # No test:smoke — try generating coverage directly if jest exists
  if [ -f "./node_modules/.bin/jest" ]; then
    echo "[Smoke Tests] Generating coverage report..."
    ./node_modules/.bin/jest --coverage --coverageReporters=lcov text 2>/dev/null || true
  fi
fi

echo "✅ [Smoke Tests] Passed ✔"

# ---------------------------------------------------------------
# Start server ONCE — used by both Newman flows below
# ---------------------------------------------------------------

SERVER_PID=""
PORT=""

START_CMD=""
if [ "$HAS_START" = "yes" ]; then
  START_CMD="npm start"
elif [ "$HAS_DEV" = "yes" ]; then
  START_CMD="npm run dev"
fi

if [ -n "$START_CMD" ]; then
  echo ""
  echo "[Server] Starting server with: $START_CMD"

  sh -c "$START_CMD" > /tmp/ci-server.log 2>&1 &
  SERVER_PID=$!

  # Detect port
  DETECTED_PORT=""

  if [ -f ".env" ]; then
    DETECTED_PORT=$(grep -E "^PORT=" .env 2>/dev/null | cut -d= -f2 | tr -d "\t\r\n ")
  fi

  if [ -z "$DETECTED_PORT" ]; then
    DETECTED_PORT=$(node -e 'try{const p=require("./package.json");const s=JSON.stringify(p.scripts||{});const m=s.match(/PORT=([0-9]+)/);if(m)process.stdout.write(m[1])}catch(e){}' 2>/dev/null)
  fi

  if [ -z "$DETECTED_PORT" ]; then
    DETECTED_PORT=$(grep -rE "\.listen\([0-9]" --include="*.js" --include="*.ts" --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null | grep -oE "[0-9]{4,5}" | head -1)
  fi

  if [ -n "$DETECTED_PORT" ]; then
    PORT_LIST="$DETECTED_PORT 3000 3001 4000 8000 8080"
  else
    PORT_LIST="3000 3001 4000 8000 8080"
  fi

  echo "[Server] Waiting for server to be ready..."
  SERVER_UP=0
  for i in $(seq 1 30); do
    if ! kill -0 $SERVER_PID 2>/dev/null; then
      echo "⚠️  [Server] Process exited early. Check your start script."
      break
    fi
    for PORT_TRY in $PORT_LIST; do
      if curl -sf http://localhost:$PORT_TRY >/dev/null 2>&1; then
        PORT=$PORT_TRY
        SERVER_UP=1
        echo "✅ [Server] Running on port $PORT"
        break 2
      fi
    done
    sleep 1
  done

  if [ $SERVER_UP -eq 0 ]; then
    echo "⚠️  [Server] Did not start within 30s — Newman tests may fail."
  fi
else
  echo "⚠️  [Server] No start/dev script found — Newman tests will run without a live server."
fi

# ---------------------------------------------------------------
# COMPULSORY: Newman API Tests
# Runs EITHER the cloud runner (test:newman) OR local collections
# Server is already up above — used by both
# ---------------------------------------------------------------

echo ""
echo "=================================================="
echo "🧪 [Newman] Running API Tests..."
echo "=================================================="

HAS_NEWMAN_SCRIPT=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts['test:newman']?'yes':'no')}catch(e){console.log('no')}" 2>/dev/null)

if [ "$HAS_NEWMAN_SCRIPT" = "yes" ]; then
  echo "[Newman] Running standardized 'test:newman' script..."
  if ! npm run test:newman; then
    echo "✖ [Newman] API tests failed. Push blocked."
    if [ -n "$SERVER_PID" ]; then kill $SERVER_PID 2>/dev/null; fi
    exit 1
  fi
else
  # Fallback: run local .postman_collection.json files directly
  echo "[Newman] No 'test:newman' script found — searching for local collections..."
  COLLECTIONS=$(find . -not -path "*/node_modules/*" -not -path "*/.git/*" -name "*.postman_collection.json" 2>/dev/null)

  if [ -n "$COLLECTIONS" ]; then
    if ! command -v newman >/dev/null 2>&1; then
      echo "[Newman] Installing newman..."
      npm install -g newman newman-reporter-htmlextra >/dev/null 2>&1 || true
    fi

    mkdir -p newman-reports
    ENV_FILE=$(find . -not -path "*/node_modules/*" -not -path "*/.git/*" -name "*.postman_environment.json" 2>/dev/null | head -1)
    NEWMAN_FAIL=0

    for COLLECTION in $COLLECTIONS; do
      NAME=$(basename "$COLLECTION" .json)
      echo "[Newman] Running: $COLLECTION"

      ENV_FLAG=""
      if [ -n "$ENV_FILE" ]; then
        ENV_FLAG="--environment $ENV_FILE"
      fi

      newman run "$COLLECTION" \
        $ENV_FLAG \
        --env-var "baseUrl=http://localhost:${PORT:-3000}" \
        --reporters cli,htmlextra \
        --reporter-htmlextra-export "newman-reports/${NAME}-report.html" \
        --bail

      if [ $? -ne 0 ]; then NEWMAN_FAIL=1; fi
    done

    if [ $NEWMAN_FAIL -ne 0 ]; then
      echo "✖ [Newman] API tests failed. Push blocked."
      if [ -n "$SERVER_PID" ]; then kill $SERVER_PID 2>/dev/null; fi
      exit 1
    fi
  else
    echo "ℹ️  [Newman] No Postman collections found. Skipping."
  fi
fi

echo "✅ [Newman] All tests completed ✔"

# ---------------------------------------------------------------
# Cleanup — kill server
# ---------------------------------------------------------------

if [ -n "$SERVER_PID" ]; then
  kill $SERVER_PID 2>/dev/null
  echo "[Server] Stopped."
fi

echo ""
echo "=================================================="
echo "✅ [CI Checks] All compulsory checks completed."
echo "=================================================="

exit 0