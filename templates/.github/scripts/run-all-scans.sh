#!/bin/bash
# =============================================================================
# run-all-scans.sh
# Scans: SonarQube SAST
# Output: Imported to DefectDojo → final report as GitHub artifact
# =============================================================================

set -euo pipefail

# ── Paths ────────────────────────────────────────────────────────────────────
WORKSPACE="${HOME}/security-scan"
APP_DIR="${WORKSPACE}/app"          # Scan entire repo root
REPORTS_DIR="${WORKSPACE}/reports"
LOG_FILE="${REPORTS_DIR}/scan.log"

# ── State ────────────────────────────────────────────────────────────────────
SONAR_RESULT="skipped"
IMPORT_COUNT=0
FINAL_FORMAT="none"
DOJO_IMPORT_FAILED=false

# ── Logging ──────────────────────────────────────────────────────────────────
mkdir -p "${REPORTS_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] ✓ $*"; }
warn() { echo "[$(date '+%H:%M:%S')] ⚠ WARNING: $*"; }
fail() { echo "[$(date '+%H:%M:%S')] ✗ ERROR: $*"; }

# ─────────────────────────────────────────────────────────────────────────────
# BANNER + VALIDATION
# ─────────────────────────────────────────────────────────────────────────────
log "======================================================="
log " Security Scan — Pipeline"
log " SHA:    ${GIT_SHA:0:8}"
log " Branch: ${GIT_BRANCH}"
log " Date:   ${RUN_DATE}"
log "======================================================="

REQUIRED=(
  GIT_SHA GIT_BRANCH RUN_DATE
  SONAR_HOST_URL SONAR_TOKEN
  DEFECTDOJO_URL DEFECTDOJO_API_KEY
  DEFECTDOJO_ENGAGEMENT_ID DEFECTDOJO_PRODUCT_ID
)
MISSING=()
for var in "${REQUIRED[@]}"; do
  [ -z "${!var:-}" ] && MISSING+=("$var")
done
if [ ${#MISSING[@]} -gt 0 ]; then
  fail "Missing required variables: ${MISSING[*]}"
  exit 1
fi
ok "All required env vars present"

# ── Clean Secrets (Strip Newlines & Whitespace) ──────────────────────────────
log "Trimming whitespace and newlines from secrets..."
SONAR_TOKEN=$(echo "${SONAR_TOKEN}" | tr -d '\r\n ')
SONAR_HOST_URL=$(echo "${SONAR_HOST_URL}" | tr -d '\r\n ')
DEFECTDOJO_URL=$(echo "${DEFECTDOJO_URL}" | tr -d '\r\n ')
DEFECTDOJO_API_KEY=$(echo "${DEFECTDOJO_API_KEY}" | tr -d '\r\n ')
DEFECTDOJO_ENGAGEMENT_ID=$(echo "${DEFECTDOJO_ENGAGEMENT_ID}" | tr -d '\r\n ')
DEFECTDOJO_PRODUCT_ID=$(echo "${DEFECTDOJO_PRODUCT_ID}" | tr -d '\r\n ')

# ── Normalize URLs ───────────────────────────────────────────────────────────
if [[ ! "${SONAR_HOST_URL}" =~ ^https?:// ]]; then
  log "Normalizing SONAR_HOST_URL to include http://"
  SONAR_HOST_URL="http://${SONAR_HOST_URL}"
fi

if [[ ! "${DEFECTDOJO_URL}" =~ ^https?:// ]]; then
  log "Normalizing DEFECTDOJO_URL to include http://"
  DEFECTDOJO_URL="http://${DEFECTDOJO_URL}"
fi

# ── Check environment ────────────────────────────────────────────────────────
command -v docker &>/dev/null || { fail "Docker not found"; exit 1; }
ok "Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"

# ── Verify APP_DIR exists ────────────────────────────────────────────────────
if [ ! -d "${APP_DIR}" ]; then
  fail "APP_DIR not found: ${APP_DIR}"
  exit 1
fi
ok "Scanning directory: ${APP_DIR}"
log "Contents of scan root:"
ls -la "${APP_DIR}" | head -30

# ── Fix permissions upfront ──────────────────────────────────────────────────
chmod -R 777 "${REPORTS_DIR}" 2>/dev/null || true
ok "Permissions set on reports directory"

# ── Check DefectDojo ─────────────────────────────────────────────────────────
log "Checking DefectDojo at ${DEFECTDOJO_URL} ..."
DOJO_OK=false
for attempt in 1 2 3; do
  DOJO_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout 15 --max-time 20 \
    "${DEFECTDOJO_URL}" 2>/dev/null || echo "000")
  if [ "${DOJO_HTTP}" != "000" ]; then
    ok "DefectDojo reachable (HTTP ${DOJO_HTTP})"
    DOJO_OK=true
    break
  fi
  warn "DefectDojo attempt ${attempt}/3 failed — retrying in 15s..."
  sleep 15
done
if [ "${DOJO_OK}" = "false" ]; then
  fail "DefectDojo not reachable at ${DEFECTDOJO_URL}"
  exit 1
fi

# ── Check SonarQube (soft) ───────────────────────────────────────────────────
log "Checking SonarQube at ${SONAR_HOST_URL} ..."
SONAR_REACHABLE=false
for attempt in 1 2 3; do
  SONAR_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout 15 --max-time 20 \
    "${SONAR_HOST_URL}" 2>/dev/null || echo "000")
  if [ "${SONAR_HTTP}" != "000" ]; then
    ok "SonarQube reachable (HTTP ${SONAR_HTTP})"
    SONAR_REACHABLE=true
    break
  fi
  warn "SonarQube attempt ${attempt}/3 — retrying in 15s..."
  sleep 15
done
[ "${SONAR_REACHABLE}" = "false" ] && \
  warn "SonarQube not reachable — SAST skipped"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — SonarQube Project Setup & SAST
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 1: SonarQube Project Setup & SAST"
log "-------------------------------------------------------"

if [ "${SONAR_REACHABLE}" = "true" ]; then
  cd "${APP_DIR}"

  # --- Derive Project Key ---
  PKG_JSON=""
  if [ -f "package.json" ]; then
    PKG_JSON="package.json"
  else
    PKG_JSON=$(find . -maxdepth 2 -name "package.json" \
      ! -path "*/node_modules/*" | head -1 || true)
  fi

  if [ -n "${PKG_JSON}" ]; then
    log "Found package.json at: ${PKG_JSON}"
    PROJECT_NAME=$(grep -m 1 '"name":' "${PKG_JSON}" | cut -d'"' -f4 || echo "unknown-project")
    SONAR_PROJECT_KEY=$(echo "${PROJECT_NAME}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._:-]/-/g')
    ok "Derived SonarQube project key: ${SONAR_PROJECT_KEY}"
  else
    warn "No package.json found — using repository name as project key"
    REPO_NAME=$(basename "${APP_DIR}")
    SONAR_PROJECT_KEY=$(echo "${REPO_NAME}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._:-]/-/g')
    PROJECT_NAME="${SONAR_PROJECT_KEY}"
    ok "Using project key: ${SONAR_PROJECT_KEY}"
  fi

  # --- Ensure SonarQube Project Exists ---
  log "Checking if project '${SONAR_PROJECT_KEY}' exists in SonarQube..."
  PROJECT_EXISTS=$(curl -s -u "${SONAR_TOKEN}:" \
    "${SONAR_HOST_URL}/api/projects/search?projects=${SONAR_PROJECT_KEY}" \
    | grep -q "\"key\":\"${SONAR_PROJECT_KEY}\"" && echo "true" || echo "false")

  if [ "${PROJECT_EXISTS}" = "false" ]; then
    log "Project not found. Creating '${SONAR_PROJECT_KEY}' (Name: ${PROJECT_NAME})..."
    CREATE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -u "${SONAR_TOKEN}:" -X POST \
      "${SONAR_HOST_URL}/api/projects/create" \
      -d "name=${PROJECT_NAME}" \
      -d "project=${SONAR_PROJECT_KEY}")
    if [ "${CREATE_STATUS}" = "200" ] || [ "${CREATE_STATUS}" = "201" ]; then
      ok "Project created (HTTP ${CREATE_STATUS})"
    else
      warn "Failed to create project (HTTP ${CREATE_STATUS}) — attempting scan anyway..."
    fi
  else
    ok "Project '${SONAR_PROJECT_KEY}' already exists"
  fi

  SONAR_OK=false

  if command -v sonar-scanner &>/dev/null; then
    log "Using installed sonar-scanner CLI..."
    sonar-scanner \
      -Dsonar.projectKey="${SONAR_PROJECT_KEY}" \
      -Dsonar.host.url="${SONAR_HOST_URL}" \
      -Dsonar.token="${SONAR_TOKEN}" \
      -Dsonar.sources=. \
      -Dsonar.exclusions="**/node_modules/**,**/dist/**,**/build/**,**/coverage/**,**/tests/**,**/seeds/**,**/scripts/**,**/.git/**" \
      -Dsonar.sourceEncoding=UTF-8 \
      2>&1 && SONAR_OK=true || SONAR_OK=false
  else
    log "Using Docker sonar-scanner-cli..."
    docker run --rm \
      --network=host \
      -v "${APP_DIR}:/usr/src" \
      sonarsource/sonar-scanner-cli:latest \
      -Dsonar.projectKey="${SONAR_PROJECT_KEY}" \
      -Dsonar.host.url="${SONAR_HOST_URL}" \
      -Dsonar.token="${SONAR_TOKEN}" \
      -Dsonar.sources=/usr/src \
      -Dsonar.exclusions="**/node_modules/**,**/dist/**,**/build/**,**/coverage/**,**/.git/**" \
      -Dsonar.sourceEncoding=UTF-8 \
      2>&1 && SONAR_OK=true || SONAR_OK=false
  fi

  if [ "${SONAR_OK}" = "true" ]; then
    log "Waiting 30s for SonarQube to process analysis..."
    sleep 30

    log "Polling SonarQube background task..."
    for i in $(seq 1 12); do
      RAW_RESP=$(curl -s -u "${SONAR_TOKEN}:" \
        "${SONAR_HOST_URL}/api/ce/component?component=${SONAR_PROJECT_KEY}")
      STATUS=$(echo "${RAW_RESP}" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      if [ -z "${STATUS}" ]; then
        STATUS="UNKNOWN"
        log "  Raw API response: ${RAW_RESP}"
      fi
      log "  Task status: ${STATUS} (attempt ${i}/12)"
      [ "${STATUS}" = "SUCCESS" ] && break
      [ "${STATUS}" = "FAILED" ] && { warn "SonarQube background task FAILED"; break; }
      sleep 10
    done

    curl -s \
      -u "${SONAR_TOKEN}:" \
      "${SONAR_HOST_URL}/api/issues/search?componentKeys=${SONAR_PROJECT_KEY}&resolved=false&ps=500" \
      -o "${REPORTS_DIR}/sonarqube-report.json"
    SIZE=$(wc -c < "${REPORTS_DIR}/sonarqube-report.json" 2>/dev/null || echo 0)

    if [ "${SIZE}" -gt 500 ]; then
      ok "SonarQube report saved (${SIZE} bytes)"
      SONAR_RESULT="passed"
    else
      warn "SonarQube report too small (${SIZE} bytes) — likely empty or error"
      warn "Raw: $(cat "${REPORTS_DIR}/sonarqube-report.json" 2>/dev/null || echo 'unreadable')"
      SONAR_RESULT="partial"
    fi
  else
    warn "SonarQube scan failed"
    SONAR_RESULT="failed"
  fi
else
  warn "Skipping SonarQube — not reachable"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Import to DefectDojo
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 2: Importing to DefectDojo"
log "-------------------------------------------------------"

do_import() {
  local FILE="$1" SCAN_TYPE="$2" LABEL="$3"
  if [ ! -f "${FILE}" ]; then
    warn "Skipping ${LABEL} — file not found: ${FILE}"
    return 1
  fi
  log "Importing ${LABEL} ($(wc -c < "${FILE}") bytes)..."
  local RESPONSE HTTP_CODE BODY
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Authorization: Token ${DEFECTDOJO_API_KEY}" \
    -F "scan_date=${RUN_DATE}" \
    -F "scan_type=${SCAN_TYPE}" \
    -F "engagement=${DEFECTDOJO_ENGAGEMENT_ID}" \
    -F "file=@${FILE}" \
    -F "close_old_findings=true" \
    -F "minimum_severity=Low" \
    -F "tags=git-sha:${GIT_SHA:0:8},branch:${GIT_BRANCH},date:${RUN_DATE}" \
    "${DEFECTDOJO_URL}/api/v2/import-scan/")
  HTTP_CODE=$(echo "${RESPONSE}" | tail -1)
  BODY=$(echo "${RESPONSE}" | head -n -1)
  if [ "${HTTP_CODE}" = "201" ]; then
    ok "${LABEL} imported (HTTP 201)"
    IMPORT_COUNT=$((IMPORT_COUNT + 1))
    return 0
  else
    warn "${LABEL} import failed (HTTP ${HTTP_CODE})"
    warn "Response: ${BODY}"
    return 1
  fi
}

do_import \
  "${REPORTS_DIR}/sonarqube-report.json" \
  "SonarQube Scan" \
  "SonarQube" || true

if [ "${IMPORT_COUNT}" -eq 0 ]; then
  warn "DefectDojo import failed — pipeline will continue and bundle raw reports"
  warn "Check:"
  warn "  1. DEFECTDOJO_API_KEY — must be the key value only (no 'Token ' prefix)"
  warn "  2. DEFECTDOJO_ENGAGEMENT_ID — must be a valid numeric ID"
  warn "  3. DEFECTDOJO_URL — e.g. http://your-host:8080"
  DOJO_IMPORT_FAILED=true
else
  ok "${IMPORT_COUNT}/1 reports imported to DefectDojo"
  DOJO_IMPORT_FAILED=false
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Generate final report from DefectDojo (or bundle raw reports)
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 3: Generating final report"
log "-------------------------------------------------------"

if [ "${DOJO_IMPORT_FAILED}" = "true" ]; then
  warn "DefectDojo unavailable — bundling raw scan reports as final output"

  SONAR_SIZE=$(wc -c < "${REPORTS_DIR}/sonarqube-report.json" 2>/dev/null || echo 0)

  cat > "${REPORTS_DIR}/final-report.json" <<EOF
{
  "scan_summary": {
    "sha": "${GIT_SHA:0:8}",
    "branch": "${GIT_BRANCH}",
    "date": "${RUN_DATE}",
    "sonarqube_result": "${SONAR_RESULT}",
    "defectdojo_import": "failed",
    "note": "DefectDojo import failed. Raw reports are included in this artifact.",
    "raw_reports": {
      "sonarqube_report_bytes": ${SONAR_SIZE}
    }
  }
}
EOF
  ok "Summary JSON written — raw reports also available in artifact"
  FINAL_FORMAT="json"

else
  sleep 15

  log "Fetching findings from DefectDojo..."
  HTTP=$(curl -s \
    -o "${REPORTS_DIR}/final-report.json" \
    -w "%{http_code}" \
    -H "Authorization: Token ${DEFECTDOJO_API_KEY}" \
    "${DEFECTDOJO_URL}/api/v2/findings/?engagement=${DEFECTDOJO_ENGAGEMENT_ID}&limit=500")
  SIZE=$(wc -c < "${REPORTS_DIR}/final-report.json" 2>/dev/null || echo 0)

  if [ "${HTTP}" = "200" ] && [ "${SIZE}" -gt 10 ]; then
    ok "DefectDojo findings report generated (${SIZE} bytes)"
    FINAL_FORMAT="json"
  else
    warn "DefectDojo report fetch failed (HTTP ${HTTP}, ${SIZE} bytes) — falling back to raw bundle"
    cat > "${REPORTS_DIR}/final-report.json" <<EOF
{
  "scan_summary": {
    "sha": "${GIT_SHA:0:8}",
    "branch": "${GIT_BRANCH}",
    "date": "${RUN_DATE}",
    "sonarqube_result": "${SONAR_RESULT}",
    "defectdojo_import": "imported_but_report_fetch_failed",
    "note": "Raw reports are included in this artifact."
  }
}
EOF
    ok "Fallback summary JSON written"
    FINAL_FORMAT="json"
  fi
fi

log "-------------------------------------------------------"
log "STEP 4: Generating HTML Report"
log "-------------------------------------------------------"
if command -v node &>/dev/null; then
  if [ -f "${WORKSPACE}/scripts/generate-html.js" ] && [ -f "${REPORTS_DIR}/final-report.json" ]; then
    node "${WORKSPACE}/scripts/generate-html.js" "${REPORTS_DIR}/final-report.json" "${REPORTS_DIR}/final-report.html"
    if [ -f "${REPORTS_DIR}/final-report.html" ]; then
      FINAL_FORMAT="json + html"
    else
      warn "Failed to generate HTML report."
    fi
  else
    warn "Missing final-report.json or generate-html.js script. Skipping HTML generation."
  fi
else
  warn "Node.js not installed on runner. Skipping HTML generation."
fi

log ""
log "Reports directory contents:"
ls -lh "${REPORTS_DIR}" || true

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
log ""
log "======================================================="
log " SCAN COMPLETE"
log " SHA: ${GIT_SHA:0:8}  Branch: ${GIT_BRANCH}"
log "-------------------------------------------------------"
log " SonarQube SAST:     ${SONAR_RESULT}"
log " DefectDojo imports: ${IMPORT_COUNT}/1"
log " Report format:      ${FINAL_FORMAT}"
log " Report:             ${REPORTS_DIR}/final-report.${FINAL_FORMAT}"
log "======================================================="
ok "Done. Report will be uploaded as GitHub artifact."
