#!/usr/bin/env bash
# =============================================================================
# AgentStore E2E Bootstrap / Teardown Script
#
# Usage:
#   ./scripts/bootstrap.sh              # Full setup
#   ./scripts/bootstrap.sh --resume     # Resume interrupted setup
#   ./scripts/bootstrap.sh --teardown   # Remove everything from cluster
#   ./scripts/bootstrap.sh --verbose    # Show debug API call info
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$SCRIPT_DIR/bootstrap.log"
DEVSERVER_LOG="$SCRIPT_DIR/bootstrap-devserver.log"
CONFIG_FILE="$SCRIPT_DIR/.bootstrap-config"
BASE="http://localhost:3000/api"
DEVSERVER_PID=""
TOTAL_PHASES=10
BOOTSTRAP_START=""
RESUME=0
VERBOSE=0
TEARDOWN=0

# =============================================================================
# Color constants
# =============================================================================
C_RESET='\033[0m'
C_PHASE='\033[1;36m'      # bold cyan   — phase headers
C_OK='\033[0;32m'         # green       — success
C_MILESTONE='\033[1;32m'  # bold green  — major milestones
C_WARN='\033[0;33m'       # yellow      — warnings / skipped
C_ERR='\033[0;31m'        # red         — errors
C_FATAL='\033[1;31m'      # bold red    — fatal errors
C_PROGRESS='\033[0;36m'   # cyan        — in-progress / polling
C_PROMPT='\033[1;33m'     # bold yellow — user input prompts
C_DIM='\033[2m'           # dim/grey    — debug info
C_BOLD='\033[1;37m'       # bold white  — summary

# =============================================================================
# Helper functions
# =============================================================================

phase()     { echo -e "\n${C_PHASE}══ [$1/$TOTAL_PHASES] $2 ══${C_RESET}\n"; }
ok()        { echo -e "  ${C_OK}✓ $1${C_RESET}"; }
milestone() { echo -e "  ${C_MILESTONE}✓ $1${C_RESET}"; }
warn()      { echo -e "  ${C_WARN}⚠ $1${C_RESET}"; }
err()       { echo -e "  ${C_ERR}✗ $1${C_RESET}"; }
info()      { echo -e "  ${C_DIM}$1${C_RESET}"; }
SPINNER_FRAMES=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
SPINNER_IDX=0
progress() {
  local spin="${SPINNER_FRAMES[$((SPINNER_IDX % ${#SPINNER_FRAMES[@]}))]}"
  ((SPINNER_IDX++)) || true
  echo -ne "\r  ${C_BOLD}${spin}${C_RESET} ${C_PROGRESS}$1${C_RESET}  "
}
ask()       { echo -ne "  ${C_PROMPT}? $1${C_RESET} "; }
debug()     { [[ "$VERBOSE" == "1" ]] && echo -e "  ${C_DIM}$1${C_RESET}" || true; }

die() {
  echo -e "\n  ${C_FATAL}FATAL: $1${C_RESET}\n" >&2
  exit 1
}

cleanup() {
  if [[ -n "$DEVSERVER_PID" ]] && kill -0 "$DEVSERVER_PID" 2>/dev/null; then
    info "Stopping dev server (PID $DEVSERVER_PID)..."
    kill "$DEVSERVER_PID" 2>/dev/null || true
    wait "$DEVSERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

elapsed() {
  local secs=$1
  printf "%dm %02ds" $((secs / 60)) $((secs % 60))
}

total_elapsed() {
  local now
  now=$(date +%s)
  elapsed $((now - BOOTSTRAP_START))
}

# ---------------------------------------------------------------------------
# api_call METHOD PATH [BODY]
#   Returns JSON body. Exits on HTTP error or .error field.
# ---------------------------------------------------------------------------
api_call() {
  local method="$1" path="$2" body="${3:-}"
  local url="${BASE}${path}"
  local tmp
  tmp=$(mktemp)

  debug "$method $url${body:+ ← ${body:0:120}}"

  local http_code
  if [[ -n "$body" ]]; then
    http_code=$(curl -s -o "$tmp" -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" -d "$body" "$url" 2>/dev/null) || true
  else
    http_code=$(curl -s -o "$tmp" -w "%{http_code}" -X "$method" "$url" 2>/dev/null) || true
  fi

  local response
  response=$(cat "$tmp" 2>/dev/null || echo '{}')
  rm -f "$tmp"

  debug "  → $http_code ${response:0:200}"

  if [[ "$http_code" -ge 400 ]]; then
    local api_err
    api_err=$(echo "$response" | jq -r '.error // empty' 2>/dev/null || echo "")
    err "$method $path → HTTP $http_code"
    [[ -n "$api_err" ]] && err "  $api_err"
    [[ -z "$api_err" ]] && err "  ${response:0:300}"
    return 1
  fi

  local api_err
  api_err=$(echo "$response" | jq -r '.error // empty' 2>/dev/null || echo "")
  if [[ -n "$api_err" ]]; then
    err "$method $path: $api_err"
    return 1
  fi

  echo "$response"
}

# ---------------------------------------------------------------------------
# phase_label RAW_PHASE → human-friendly label
# ---------------------------------------------------------------------------
phase_label() {
  case "$1" in
    building)            echo "Building" ;;
    waiting-for-rollout) echo "Waiting for rollout" ;;
    syncing-project)     echo "Syncing AAP project" ;;
    creating-templates)  echo "Creating job templates" ;;
    done)                echo "Complete" ;;
    installing)          echo "Installing" ;;
    ""|null|unknown)     echo "" ;;
    *)                   echo "$1" ;;
  esac
}

# ---------------------------------------------------------------------------
# poll_deploy PATH JQ_STATUS JQ_PHASE JQ_OCP_PHASE DONE_VALS FAIL_VALS
#             TIMEOUT INTERVAL LABEL ETA_HINT
#
#   Phase-aware poller with animated spinner, sub-phase transitions, and ETA.
#   Always returns 0 (safe with set -e). Sets globals:
#     POLL_RESULT  — last JSON response
#     POLL_RC      — 0=done, 1=failed, 2=timeout
# ---------------------------------------------------------------------------
POLL_RESULT=""
POLL_RC=0

poll_deploy() {
  local path="$1" jq_status="$2" jq_phase="${3:-}" jq_ocp="${4:-}"
  local done_vals="$5" fail_vals="$6"
  local timeout="$7" interval="$8" label="$9" eta="${10:-}"
  local start elapsed_s status phase_val ocp_val resp
  local prev_phase="" prev_ocp=""

  POLL_RESULT=""
  POLL_RC=0
  start=$(date +%s)

  while true; do
    elapsed_s=$(( $(date +%s) - start ))
    resp=$(api_call GET "$path" 2>/dev/null) || resp="{}"
    status=$(echo "$resp" | jq -r "$jq_status // \"unknown\"" 2>/dev/null)

    # Extract sub-phase fields if expressions provided
    phase_val=""
    ocp_val=""
    [[ -n "$jq_phase" ]] && phase_val=$(echo "$resp" | jq -r "$jq_phase // empty" 2>/dev/null)
    [[ -n "$jq_ocp" ]]   && ocp_val=$(echo "$resp" | jq -r "$jq_ocp // empty" 2>/dev/null)

    # Print permanent transition lines on phase changes
    if [[ -n "$phase_val" && "$phase_val" != "$prev_phase" && -n "$prev_phase" ]]; then
      local friendly
      friendly=$(phase_label "$phase_val")
      echo ""
      [[ -n "$friendly" ]] && info "  $friendly ($(elapsed $elapsed_s))"
    fi
    if [[ -n "$ocp_val" && "$ocp_val" != "$prev_ocp" && -n "$prev_ocp" ]]; then
      echo ""
      info "  OCP build: $ocp_val ($(elapsed $elapsed_s))"
    fi
    prev_phase="$phase_val"
    prev_ocp="$ocp_val"

    # Build rich progress line
    local detail=""
    if [[ -n "$phase_val" ]]; then
      local friendly
      friendly=$(phase_label "$phase_val")
      [[ -n "$friendly" ]] && detail="$friendly"
    fi
    if [[ -n "$ocp_val" && "$ocp_val" != "null" ]]; then
      if [[ -n "$detail" ]]; then
        detail="$detail (OCP: $ocp_val)"
      else
        detail="OCP: $ocp_val"
      fi
    fi
    if [[ -z "$detail" ]]; then
      detail="$status"
    fi

    local time_info
    time_info="$(elapsed $elapsed_s)"
    [[ -n "$eta" ]] && time_info="$time_info / ~$eta"

    progress "$label: $detail — $time_info"

    # Check done
    if echo "$done_vals" | tr '|' '\n' | grep -qx "$status"; then
      echo ""
      POLL_RESULT="$resp"
      POLL_RC=0
      return 0
    fi

    # Check fail
    if echo "$fail_vals" | tr '|' '\n' | grep -qx "$status"; then
      echo ""
      POLL_RESULT="$resp"
      POLL_RC=1
      return 0
    fi

    # Timeout
    if [[ $elapsed_s -ge $timeout ]]; then
      echo ""
      warn "Timeout after $(elapsed $timeout) waiting for $label"
      POLL_RESULT="$resp"
      POLL_RC=2
      return 0
    fi

    # Animated wait — spin visually between API polls
    local wait_end=$(( $(date +%s) + interval ))
    while [[ $(date +%s) -lt $wait_end ]]; do
      elapsed_s=$(( $(date +%s) - start ))
      time_info="$(elapsed $elapsed_s)"
      [[ -n "$eta" ]] && time_info="$time_info / ~$eta"
      progress "$label: $detail — $time_info"
      sleep 0.3
    done
  done
}

# ---------------------------------------------------------------------------
# Config file helpers — save/load platform inputs between runs
# ---------------------------------------------------------------------------
load_config() {
  if [[ -f "$CONFIG_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CONFIG_FILE"
    return 0
  fi
  return 1
}

save_config() {
  cat > "$CONFIG_FILE" <<EOF
# Auto-generated by bootstrap.sh — do not commit
SAVED_OCP_API='${OCP_API}'
SAVED_OCP_CONSOLE='${OCP_CONSOLE}'
SAVED_AAP_URL='${AAP_URL}'
SAVED_OCP_NS='${OCP_NS}'
SAVED_GIT_URL='${GIT_URL}'
SAVED_GIT_BRANCH='${GIT_BRANCH}'
EOF
  debug "Config saved to $CONFIG_FILE"
}

prompt_required() {
  local label="$1" var_name="$2" default="${3:-}"
  local val=""
  while [[ -z "$val" ]]; do
    if [[ -n "$default" ]]; then
      ask "$label\n    ${C_DIM}[${default}]${C_RESET}\n  ${C_PROMPT}?${C_RESET} "
    else
      ask "$label: "
    fi
    read -r val
    val="${val:-$default}"
    [[ -z "$val" ]] && err "$label is required"
  done
  eval "$var_name='$val'"
}

prompt_optional() {
  local label="$1" var_name="$2" default="${3:-}"
  if [[ -n "$default" ]]; then
    ask "$label [${default}]: "
  else
    ask "$label (Enter to skip): "
  fi
  local val=""
  read -r val
  val="${val:-$default}"
  eval "$var_name='$val'"
}

prompt_secret() {
  local label="$1" var_name="$2" required="${3:-0}"
  ask "$label: "
  local val=""
  read -rs val
  echo ""
  if [[ -z "$val" && "$required" == "1" ]]; then
    die "$label is required"
  fi
  eval "$var_name='$val'"
}

prompt_yn() {
  local label="$1" default="${2:-Y}"
  ask "$label [${default}]: "
  local val=""
  read -r val
  val="${val:-$default}"
  [[ "$val" =~ ^[Yy] ]]
}

set_secret() {
  local key="$1" value="$2"
  api_call PATCH "/admin/secrets/$key" "{\"value\":\"$value\"}" > /dev/null || die "Failed to set secret $key"
  ok "$key set"
}

# =============================================================================
# Parse arguments
# =============================================================================
for arg in "$@"; do
  case "$arg" in
    --resume)  RESUME=1 ;;
    --verbose) VERBOSE=1 ;;
    --teardown) TEARDOWN=1 ;;
    --help|-h)
      echo "Usage: bootstrap.sh [--resume] [--teardown] [--verbose]"
      echo "  --resume    Skip already-completed phases"
      echo "  --teardown  Remove all AgentStore resources from the cluster"
      echo "  --verbose   Show debug API call info"
      exit 0
      ;;
    *) die "Unknown argument: $arg" ;;
  esac
done

# =============================================================================
# TEARDOWN MODE
# =============================================================================
if [[ "$TEARDOWN" == "1" ]]; then
  echo -e "\n${C_PHASE}══ AgentStore Teardown ══${C_RESET}\n"
  echo -e "  ${C_WARN}WARNING: This will permanently delete ALL AgentStore resources from"
  echo -e "  the cluster, including:${C_RESET}"
  echo ""
  echo -e "    • Namespace: ${C_BOLD}agentstore${C_RESET}             (AgentStore console, builds, images)"
  echo -e "    • Namespace: ${C_BOLD}agent-workloads${C_RESET}    (deployed agent pods, routes)"
  echo -e "    • Namespace: ${C_BOLD}rhdh${C_RESET}                (Developer Hub operator + instance)"
  echo -e "    • Namespace: ${C_BOLD}openshell${C_RESET}           (OpenShell gateway)"
  echo -e "    • Namespace: ${C_BOLD}agent-sandbox-system${C_RESET} (Agent Sandbox Controller)"
  echo -e "    • AAP resources                (Project, Job Templates, EE, Credentials)"
  echo ""
  echo -e "  ${C_FATAL}This action CANNOT be undone.${C_RESET}"
  echo ""
  ask "Type 'teardown' to confirm: "
  read -r confirmation
  [[ "$confirmation" != "teardown" ]] && die "Aborted — you must type 'teardown' to proceed"

  # --- Need OCP connection for namespace deletion ---
  OCP_API=""
  OCP_TOKEN=""
  PLATFORM_FILE="$REPO_DIR/apps/web/.data/platform.json"
  if [[ -f "$PLATFORM_FILE" ]]; then
    OCP_API=$(jq -r '.openshiftApiUrl // empty' "$PLATFORM_FILE" 2>/dev/null || echo "")
    info "Read OCP API from local settings: $OCP_API"
  fi
  VAULT_FILE="$REPO_DIR/apps/web/.data/vault.json"

  if [[ -z "$OCP_API" ]]; then
    prompt_required "OpenShift API URL" OCP_API "https://api.cluster.example.com:6443"
  fi
  prompt_secret "OpenShift API token" OCP_TOKEN 1

  # Test OCP connectivity
  info "Testing OpenShift connection..."
  OCP_RESP=$(curl -sk -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $OCP_TOKEN" \
    "$OCP_API/api/v1/namespaces" 2>/dev/null) || true
  [[ "$OCP_RESP" -ge 400 || -z "$OCP_RESP" ]] && die "Cannot connect to OpenShift API ($OCP_API) — HTTP $OCP_RESP"
  ok "OpenShift connected"

  # --- Stop running agents (best-effort via local dev server if running) ---
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000" 2>/dev/null | grep -q "200"; then
    info "Local AgentStore running — stopping deployed agents..."
    LISTINGS=$(curl -s "$BASE/listings?department=all" 2>/dev/null || echo "[]")
    echo "$LISTINGS" | jq -r '.[] | select(.deployment.status == "running" or .openshellSession.status == "running") | .id' 2>/dev/null | while read -r lid; do
      LNAME=$(echo "$LISTINGS" | jq -r ".[] | select(.id == \"$lid\") | .name" 2>/dev/null)
      curl -s -X DELETE "$BASE/admin/listings/$lid/deploy" > /dev/null 2>&1 && ok "Stopped agent: $LNAME" || warn "Could not stop $LNAME"
      curl -s -X DELETE "$BASE/admin/listings/$lid/openshell-session" > /dev/null 2>&1 || true
    done
  else
    info "Local AgentStore not running — skipping agent stop (namespaces will be deleted)"
  fi

  # --- Delete namespaces ---
  delete_namespace() {
    local ns="$1" timeout="$2"
    info "Deleting namespace $ns..."
    local code
    code=$(curl -sk -o /dev/null -w "%{http_code}" -X DELETE \
      -H "Authorization: Bearer $OCP_TOKEN" \
      "$OCP_API/api/v1/namespaces/$ns" 2>/dev/null) || true

    if [[ "$code" == "404" ]]; then
      info "Namespace $ns not found — already clean"
      return 0
    fi
    if [[ "$code" -ge 400 && "$code" != "409" ]]; then
      warn "Delete namespace $ns returned HTTP $code"
      return 0
    fi

    # Poll until gone
    local start elapsed_s
    start=$(date +%s)
    while true; do
      elapsed_s=$(( $(date +%s) - start ))
      code=$(curl -sk -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $OCP_TOKEN" \
        "$OCP_API/api/v1/namespaces/$ns" 2>/dev/null) || true
      if [[ "$code" == "404" ]]; then
        ok "Namespace $ns deleted ($(elapsed $elapsed_s))"
        return 0
      fi
      if [[ $elapsed_s -ge $timeout ]]; then
        warn "Namespace $ns still terminating after $(elapsed $timeout) — may need manual cleanup"
        return 0
      fi
      progress "Waiting for namespace $ns to terminate ($(elapsed $elapsed_s))"
      sleep 5
    done
  }

  delete_namespace "rhdh" 120
  delete_namespace "openshell" 60
  delete_namespace "agent-sandbox-system" 60
  delete_namespace "agent-workloads" 60
  delete_namespace "agentstore" 120

  # --- Optional: Clean AAP resources ---
  echo ""
  if prompt_yn "Also remove AAP resources (Project, Job Templates, EE)?" "N"; then
    AAP_URL=""
    AAP_TOKEN_VAL=""
    if [[ -f "$PLATFORM_FILE" ]]; then
      AAP_URL=$(jq -r '.aapControllerUrl // empty' "$PLATFORM_FILE" 2>/dev/null || echo "")
    fi
    if [[ -z "$AAP_URL" ]]; then
      prompt_required "AAP controller URL" AAP_URL "https://aap-aap.apps.cluster.example.com"
    fi
    prompt_secret "AAP token" AAP_TOKEN_VAL 1

    aap_delete() {
      local path="$1" label="$2"
      local code
      code=$(curl -sk -o /dev/null -w "%{http_code}" -X DELETE \
        -H "Authorization: Bearer $AAP_TOKEN_VAL" \
        "${AAP_URL}${path}" 2>/dev/null) || true
      if [[ "$code" -lt 300 || "$code" == "404" ]]; then
        ok "$label removed"
      else
        warn "Could not remove $label (HTTP $code)"
      fi
    }

    if [[ -f "$PLATFORM_FILE" ]]; then
      JT_AUTO=$(jq -r '.aapBootstrap.autonomousJobTemplateId // empty' "$PLATFORM_FILE" 2>/dev/null || echo "")
      JT_COLLAB=$(jq -r '.aapBootstrap.collaborativeJobTemplateId // empty' "$PLATFORM_FILE" 2>/dev/null || echo "")
      PROJECT_ID=$(jq -r '.aapBootstrap.projectId // empty' "$PLATFORM_FILE" 2>/dev/null || echo "")
      EE_ID=$(jq -r '.aapExecutionEnvironmentId // empty' "$PLATFORM_FILE" 2>/dev/null || echo "")

      [[ -n "$JT_AUTO" ]]   && aap_delete "/api/v2/job_templates/$JT_AUTO/" "Autonomous Job Template #$JT_AUTO"
      [[ -n "$JT_COLLAB" ]] && aap_delete "/api/v2/job_templates/$JT_COLLAB/" "Collaborative Job Template #$JT_COLLAB"
      [[ -n "$PROJECT_ID" ]] && aap_delete "/api/v2/projects/$PROJECT_ID/" "AAP Project #$PROJECT_ID"
      [[ -n "$EE_ID" ]]     && aap_delete "/api/v2/execution_environments/$EE_ID/" "Execution Environment #$EE_ID"
    else
      warn "No local platform.json found — cannot determine AAP resource IDs"
      info "Remove AAP resources manually from the AAP console"
    fi
  fi

  # --- Optional: Clean local state ---
  echo ""
  if prompt_yn "Also reset local AgentStore state (.data/)?" "N"; then
    local_data="$REPO_DIR/apps/web/.data"
    rm -f "$local_data/platform.json" 2>/dev/null || true
    rm -f "$local_data/vault.json" 2>/dev/null || true
    rm -f "$local_data/catalog-overrides.json" 2>/dev/null || true
    rm -f "$local_data/deleted-listings.json" 2>/dev/null || true
    rm -f "$local_data/providers.json" 2>/dev/null || true
    rm -rf "$local_data/custom-listings" 2>/dev/null || true
    ok "Local state cleared"
  else
    info "Local state preserved — re-run bootstrap.sh to redeploy to a new cluster"
  fi

  # --- Teardown summary ---
  echo ""
  echo -e "${C_BOLD}╔══════════════════════════════════════════════════════════════╗${C_RESET}"
  echo -e "${C_BOLD}║              AgentStore Teardown Complete                    ║${C_RESET}"
  echo -e "${C_BOLD}╠══════════════════════════════════════════════════════════════╣${C_RESET}"
  echo -e "${C_BOLD}║${C_RESET}                                                              ${C_BOLD}║${C_RESET}"
  echo -e "${C_BOLD}║${C_RESET}  The cluster is back to its original state.                  ${C_BOLD}║${C_RESET}"
  echo -e "${C_BOLD}║${C_RESET}  Re-run ${C_DIM}bootstrap.sh${C_RESET} to set up again.                        ${C_BOLD}║${C_RESET}"
  echo -e "${C_BOLD}║${C_RESET}                                                              ${C_BOLD}║${C_RESET}"
  echo -e "${C_BOLD}╚══════════════════════════════════════════════════════════════╝${C_RESET}"
  exit 0
fi

# =============================================================================
# BOOTSTRAP MODE
# =============================================================================
BOOTSTRAP_START=$(date +%s)
exec > >(tee -a "$LOG_FILE") 2>&1

echo -e "\n${C_BOLD}╔══════════════════════════════════════════════════════════════╗${C_RESET}"
echo -e "${C_BOLD}║              AgentStore Bootstrap                            ║${C_RESET}"
echo -e "${C_BOLD}╚══════════════════════════════════════════════════════════════╝${C_RESET}"
info "Log: $LOG_FILE"
echo ""

# =============================================================================
# Phase 0 — Prerequisites and dev server
# =============================================================================
phase 0 "Prerequisites & Dev Server"

# Check required tools
for tool in node npm curl jq; do
  if ! command -v "$tool" &>/dev/null; then
    case "$tool" in
      jq)   die "$tool not found. Install with: brew install jq (macOS) or sudo dnf install jq (RHEL)" ;;
      node) die "$tool not found. Install Node.js 20+ from https://nodejs.org" ;;
      *)    die "$tool not found" ;;
    esac
  fi
done
ok "Prerequisites: node $(node -v), npm $(npm -v 2>/dev/null), curl, jq"

# npm install if needed
cd "$REPO_DIR"
if [[ ! -d "node_modules" ]]; then
  info "Running npm install (first time)..."
  npm install || die "npm install failed — check network and package.json"
  ok "npm install complete"
else
  ok "node_modules present"
fi

# Start dev server
if curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000" 2>/dev/null | grep -q "200"; then
  ok "Dev server already running at http://localhost:3000"
else
  info "Starting dev server..."
  npm run dev > "$DEVSERVER_LOG" 2>&1 &
  DEVSERVER_PID=$!

  # Wait for server to be ready
  local_start=$(date +%s)
  while true; do
    local_elapsed=$(( $(date +%s) - local_start ))
    if curl -s -o /dev/null "http://localhost:3000" 2>/dev/null; then
      echo ""
      ok "Dev server ready ($(elapsed $local_elapsed))"
      break
    fi
    if [[ $local_elapsed -ge 90 ]]; then
      echo ""
      err "Dev server failed to start within 90s"
      info "Last 20 lines of dev server log:"
      tail -20 "$DEVSERVER_LOG" 2>/dev/null | while IFS= read -r line; do info "  $line"; done
      die "Dev server startup timeout"
    fi
    progress "Waiting for dev server ($(elapsed $local_elapsed))"
    sleep 2
  done
fi

# =============================================================================
# Phase 1 — Configure Platform & Credentials
# =============================================================================
phase 1 "Configure Platform & Credentials"

# Load saved config from previous run (if any) as defaults
SAVED_OCP_API="" SAVED_OCP_CONSOLE="" SAVED_AAP_URL=""
SAVED_OCP_NS="" SAVED_GIT_URL="" SAVED_GIT_BRANCH=""
if load_config; then
  info "Loaded saved config from $CONFIG_FILE"
fi

# Auto-detect git info (saved config overrides git-detected defaults)
GIT_URL_DEFAULT="${SAVED_GIT_URL:-$(cd "$REPO_DIR" && git remote get-url origin 2>/dev/null || echo "")}"
GIT_BRANCH_DEFAULT="${SAVED_GIT_BRANCH:-$(cd "$REPO_DIR" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")}"

SKIP_PROMPTS=0

# --- Smart resume: load existing config from API + check secrets ---
if [[ "$RESUME" == "1" ]]; then
  info "Resuming — checking current state..."
  PLAT_JSON=$(api_call GET "/admin/platform" 2>/dev/null) || PLAT_JSON="{}"
  SECRETS_JSON=$(api_call GET "/admin/secrets" 2>/dev/null) || SECRETS_JSON="[]"

  # API values first, fall back to saved config from previous run
  OCP_API=$(echo "$PLAT_JSON" | jq -r '.openshiftApiUrl // empty' 2>/dev/null)
  OCP_API="${OCP_API:-$SAVED_OCP_API}"
  OCP_CONSOLE=$(echo "$PLAT_JSON" | jq -r '.openshiftConsoleUrl // empty' 2>/dev/null)
  OCP_CONSOLE="${OCP_CONSOLE:-$SAVED_OCP_CONSOLE}"
  AAP_URL=$(echo "$PLAT_JSON" | jq -r '.aapControllerUrl // empty' 2>/dev/null)
  AAP_URL="${AAP_URL:-$SAVED_AAP_URL}"
  OCP_NS=$(echo "$PLAT_JSON" | jq -r '.openshiftNamespace // empty' 2>/dev/null)
  OCP_NS="${OCP_NS:-${SAVED_OCP_NS:-agent-workloads}}"
  GIT_URL=$(echo "$PLAT_JSON" | jq -r '.aapProjectGitUrl // empty' 2>/dev/null)
  GIT_URL="${GIT_URL:-$SAVED_GIT_URL}"
  GIT_BRANCH=$(echo "$PLAT_JSON" | jq -r '.aapProjectGitBranch // empty' 2>/dev/null)
  GIT_BRANCH="${GIT_BRANCH:-${SAVED_GIT_BRANCH:-main}}"

  has_secret() { echo "$SECRETS_JSON" | jq -e ".[] | select(.key == \"$1\" and .hasValue == true)" > /dev/null 2>&1; }

  echo ""
  echo -e "  ${C_BOLD}OpenShift${C_RESET}"
  [[ -n "$OCP_API" ]]     && ok "OpenShift API URL: $OCP_API (loaded)" || warn "OpenShift API URL: not set"
  [[ -n "$OCP_CONSOLE" ]] && ok "OpenShift console URL: $OCP_CONSOLE (loaded)" || warn "OpenShift console URL: not set"
  has_secret "OPENSHIFT_TOKEN" && ok "OPENSHIFT_TOKEN: ●●●●●●●● (already set)" || warn "OPENSHIFT_TOKEN: not set"

  echo ""
  echo -e "  ${C_BOLD}Ansible Automation Platform${C_RESET}"
  [[ -n "$AAP_URL" ]] && ok "AAP controller URL: $AAP_URL (loaded)" || warn "AAP controller URL: not set"
  has_secret "AAP_TOKEN" && ok "AAP_TOKEN: ●●●●●●●● (already set)" || warn "AAP_TOKEN: not set"

  echo ""
  echo -e "  ${C_BOLD}Project Settings${C_RESET}"
  ok "Namespace: $OCP_NS (loaded)"
  [[ -n "$GIT_URL" ]] && ok "Git: $GIT_URL @ $GIT_BRANCH (loaded)" || warn "Git repo URL: not set"

  echo ""
  echo -e "  ${C_BOLD}Optional Secrets${C_RESET}"
  has_secret "GITHUB_PACKAGES_TOKEN" && ok "GITHUB_PACKAGES_TOKEN: ●●●●●●●● (already set)" || warn "GITHUB_PACKAGES_TOKEN: not set"
  has_secret "GIT_PAT" && ok "GIT_PAT: ●●●●●●●● (already set)" || warn "GIT_PAT: not set"
  has_secret "AGENTSTORE_SERVICE_TOKEN" && ok "AGENTSTORE_SERVICE_TOKEN: ●●●●●●●● (already set)" || warn "AGENTSTORE_SERVICE_TOKEN: not set"

  echo ""
  if [[ -n "$OCP_API" && -n "$OCP_CONSOLE" && -n "$AAP_URL" ]] \
     && has_secret "OPENSHIFT_TOKEN" && has_secret "AAP_TOKEN"; then
    if prompt_yn "Use these settings?" "Y"; then
      SKIP_PROMPTS=1
      # Push config to API (may have come from saved config, not API)
      PLATFORM_BODY=$(jq -n \
        --arg aap "$AAP_URL" \
        --arg ocp "$OCP_API" \
        --arg console "$OCP_CONSOLE" \
        --arg ns "$OCP_NS" \
        --arg git "$GIT_URL" \
        --arg branch "$GIT_BRANCH" \
        '{
          aapControllerUrl: $aap,
          aapInsecureTls: true,
          openshiftApiUrl: $ocp,
          openshiftConsoleUrl: $console,
          openshiftNamespace: $ns,
          openshiftInsecureTls: true,
          aapProjectGitUrl: $git,
          aapProjectGitBranch: $branch
        }')
      api_call PATCH "/admin/platform" "$PLATFORM_BODY" > /dev/null || die "Failed to save platform settings"
      ok "Platform settings applied to API"
    fi
  else
    warn "Some required fields are missing — prompting for all values"
  fi
fi

# --- Interactive prompts (skipped on successful resume) ---
if [[ "$SKIP_PROMPTS" == "0" ]]; then
  [[ -n "$GIT_URL_DEFAULT" ]] && info "Detected git remote: $GIT_URL_DEFAULT"
  [[ -n "$GIT_BRANCH_DEFAULT" ]] && info "Detected branch: $GIT_BRANCH_DEFAULT"

  # --- OpenShift: URLs then token ---
  echo ""
  echo -e "  ${C_BOLD}OpenShift${C_RESET}"
  prompt_required "OpenShift API URL" OCP_API "${SAVED_OCP_API:-https://api.cluster.example.com:6443}"
  [[ ! "$OCP_API" =~ ^https:// ]] && die "OpenShift API URL must start with https://"
  [[ ! "$OCP_API" =~ :[0-9]+$ ]] && warn "OpenShift API URL usually includes :6443"

  prompt_required "OpenShift console URL" OCP_CONSOLE "${SAVED_OCP_CONSOLE:-https://console-openshift-console.apps.cluster.example.com}"
  [[ ! "$OCP_CONSOLE" =~ apps\. ]] && warn "Console URL should contain 'apps.' for Route URL derivation"

  prompt_secret "OpenShift API token" OCP_TOKEN_VAL 1
  set_secret "OPENSHIFT_TOKEN" "$OCP_TOKEN_VAL"

  # --- AAP: URL then token ---
  echo ""
  echo -e "  ${C_BOLD}Ansible Automation Platform${C_RESET}"
  prompt_required "AAP controller URL" AAP_URL "${SAVED_AAP_URL:-https://aap-aap.apps.cluster.example.com}"
  AAP_URL="${AAP_URL%/}"
  [[ ! "$AAP_URL" =~ ^https:// ]] && die "AAP URL must start with https://"

  prompt_secret "AAP controller token" AAP_TOKEN_VAL 1
  set_secret "AAP_TOKEN" "$AAP_TOKEN_VAL"

  # --- Additional settings ---
  echo ""
  echo -e "  ${C_BOLD}Project Settings${C_RESET}"
  prompt_optional "OpenShift workload namespace" OCP_NS "${SAVED_OCP_NS:-agent-workloads}"
  prompt_optional "Git repo URL" GIT_URL "$GIT_URL_DEFAULT"
  prompt_optional "Git branch" GIT_BRANCH "$GIT_BRANCH_DEFAULT"

  # --- Optional secrets ---
  echo ""
  echo -e "  ${C_BOLD}Optional Secrets${C_RESET}"
  prompt_secret "GitHub Packages token (Enter to skip)" GH_PKG_TOKEN 0
  if [[ -n "$GH_PKG_TOKEN" ]]; then
    set_secret "GITHUB_PACKAGES_TOKEN" "$GH_PKG_TOKEN"
  else
    warn "Skipping — Agent Sandbox Service build will fail if @nvidia/openshell-sdk is needed"
  fi

  prompt_secret "Git PAT for repo cloning (Enter to skip)" GIT_PAT_VAL 0
  if [[ -n "$GIT_PAT_VAL" ]]; then
    set_secret "GIT_PAT" "$GIT_PAT_VAL"
  else
    info "Skipping — OpenShell agents won't be able to clone private repos"
  fi

  # Auto-generate AGENTSTORE_SERVICE_TOKEN
  SVC_TOKEN=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || openssl rand -hex 24)
  set_secret "AGENTSTORE_SERVICE_TOKEN" "$SVC_TOKEN"
  info "Auto-generated service token: ${SVC_TOKEN:0:8}..."

  # --- Save platform settings to API ---
  echo ""
  PLATFORM_BODY=$(jq -n \
    --arg aap "$AAP_URL" \
    --arg ocp "$OCP_API" \
    --arg console "$OCP_CONSOLE" \
    --arg ns "$OCP_NS" \
    --arg git "$GIT_URL" \
    --arg branch "$GIT_BRANCH" \
    '{
      aapControllerUrl: $aap,
      aapInsecureTls: true,
      openshiftApiUrl: $ocp,
      openshiftConsoleUrl: $console,
      openshiftNamespace: $ns,
      openshiftInsecureTls: true,
      aapProjectGitUrl: $git,
      aapProjectGitBranch: $branch
    }')

  api_call PATCH "/admin/platform" "$PLATFORM_BODY" > /dev/null || die "Failed to save platform settings"
  ok "Platform settings saved"

  # Save to local config for next run
  save_config
fi

echo ""
info "  OCP API:        $OCP_API"
info "  OCP Console:    $OCP_CONSOLE"
info "  AAP URL:        $AAP_URL"
info "  Namespace:      $OCP_NS"
info "  Git:            $GIT_URL @ $GIT_BRANCH"

# =============================================================================
# Phase 2 — Validate Connectivity
# =============================================================================
phase 2 "Validate Connectivity"

info "Testing OpenShift connection..."
OCP_RESULT=$(api_call POST "/admin/platform/test" '{"target":"openshift"}') || {
  err "OpenShift connection failed"
  info "  • Check that the API URL is correct (include :6443)"
  info "  • Check that the token is valid — run: oc whoami -t"
  info "  • If using self-signed TLS, openshiftInsecureTls is already set to true"
  die "Cannot continue without OpenShift connectivity"
}
ok "OpenShift connected"

info "Testing AAP connection..."
AAP_RESULT=$(api_call POST "/admin/platform/test" '{"target":"aap"}') || {
  err "AAP connection failed"
  info "  • Check that the AAP URL is correct and reachable"
  info "  • Check that the AAP token is valid (not expired)"
  info "  • If using self-signed TLS, aapInsecureTls is already set to true"
  die "Cannot continue without AAP connectivity"
}
ok "AAP connected"

# =============================================================================
# Phase 3 — Deploy AgentStore to OpenShift
# =============================================================================
phase 3 "Deploy AgentStore to OpenShift"

# Resume check
PLAT=$(api_call GET "/admin/platform") || die "Cannot read platform status"
AS_STATUS=$(echo "$PLAT" | jq -r '.agentstoreDeploy.status // "none"' 2>/dev/null)
AS_ROUTE=$(echo "$PLAT" | jq -r '.agentstoreDeploy.routeUrl // empty' 2>/dev/null)

if [[ "$RESUME" == "1" && "$AS_STATUS" == "running" && -n "$AS_ROUTE" ]]; then
  ok "AgentStore already deployed at $AS_ROUTE"
else
  info "Starting AgentStore build + deploy..."
  api_call POST "/admin/platform/agentstore-deploy" > /dev/null || die "Failed to start AgentStore deploy"

  poll_deploy "/admin/platform/agentstore-deploy" ".agentstoreDeploy.status" \
    ".agentstoreDeploy.phase" ".agentstoreDeploy.ocpPhase" \
    "running" "failed" 600 10 "AgentStore deploy" "4-6 min"

  if [[ $POLL_RC -ne 0 ]]; then
    AS_ERR=$(echo "$POLL_RESULT" | jq -r '.agentstoreDeploy.error // "unknown"' 2>/dev/null)
    err "AgentStore deploy failed: $AS_ERR"
    info "  Check the OpenShift console for Build/Deployment logs in the 'agentstore' namespace"
    die "AgentStore deploy failed"
  fi

  AS_ROUTE=$(echo "$POLL_RESULT" | jq -r '.agentstoreDeploy.routeUrl // empty' 2>/dev/null)
  milestone "AgentStore deployed — Route: $AS_ROUTE"
fi

# Ensure workload namespace exists
info "Ensuring namespace '$OCP_NS' exists..."
# Get OCP token: from Phase 1 prompt, or re-read from the API's internal test
# We use the OCP API directly — need token from prompt or oc CLI
OCP_TOKEN_FOR_NS="${OCP_TOKEN_VAL:-}"
if [[ -z "$OCP_TOKEN_FOR_NS" ]] && command -v oc &>/dev/null; then
  OCP_TOKEN_FOR_NS=$(oc whoami -t 2>/dev/null || echo "")
fi
if [[ -n "$OCP_TOKEN_FOR_NS" ]]; then
  NS_BODY=$(jq -n --arg ns "$OCP_NS" '{"apiVersion":"v1","kind":"Namespace","metadata":{"name":$ns}}')
  NS_CODE=$(curl -sk -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $OCP_TOKEN_FOR_NS" \
    -H "Content-Type: application/json" \
    -d "$NS_BODY" \
    "$OCP_API/api/v1/namespaces" 2>/dev/null) || true
  if [[ "$NS_CODE" == "201" ]]; then
    ok "Namespace '$OCP_NS' created"
  elif [[ "$NS_CODE" == "409" || "$NS_CODE" == "200" ]]; then
    ok "Namespace '$OCP_NS' already exists"
  else
    warn "Could not create namespace '$OCP_NS' (HTTP $NS_CODE) — create it manually if needed"
  fi
else
  # No token available — check via unauthenticated GET (may fail, that's ok)
  NS_CHECK=$(curl -sk -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer dummy" \
    "$OCP_API/api/v1/namespaces/$OCP_NS" 2>/dev/null) || true
  if [[ "$NS_CHECK" == "200" ]]; then
    ok "Namespace '$OCP_NS' already exists"
  else
    warn "Cannot create namespace '$OCP_NS' — run: oc new-project $OCP_NS"
  fi
fi

# =============================================================================
# Phase 4 — Build Execution Environment
# =============================================================================
phase 4 "Build Execution Environment"

PLAT=$(api_call GET "/admin/platform") || true
EE_STATUS=$(echo "$PLAT" | jq -r '.eeBuild.status // "none"' 2>/dev/null)
EE_ID=$(echo "$PLAT" | jq -r '.eeBuild.executionEnvironmentId // empty' 2>/dev/null)

if [[ "$RESUME" == "1" && "$EE_STATUS" == "running" && -n "$EE_ID" ]]; then
  ok "EE already built (ID: $EE_ID)"
else
  for attempt in 1 2; do
    info "Building Execution Environment image on OpenShift${attempt:+$([ $attempt -gt 1 ] && echo " (retry $attempt/2)")}..."
    if [[ $attempt -eq 1 ]]; then
      api_call POST "/admin/platform/execution-environment-build" '{"name":"AgentStore execution environment"}' > /dev/null || die "Failed to start EE build"
    fi

    poll_deploy "/admin/platform/execution-environment-build" ".eeBuild.status" \
      ".eeBuild.phase" ".eeBuild.ocpPhase" \
      "running" "failed" 600 10 "EE build" "3-5 min"

    if [[ $POLL_RC -eq 0 ]]; then
      EE_ID=$(echo "$POLL_RESULT" | jq -r '.eeBuild.executionEnvironmentId // "?"' 2>/dev/null)
      milestone "EE built + registered in AAP (ID: $EE_ID)"
      break
    fi

    # Failure — fetch log
    err "EE build failed"
    BUILD_LOG=$(api_call GET "/admin/platform/execution-environment-build/log" 2>/dev/null || echo '{"log":"(no log available)"}')
    echo "$BUILD_LOG" | jq -r '.log // ""' 2>/dev/null | tail -40 | while IFS= read -r line; do info "  $line"; done

    if [[ $attempt -eq 1 ]]; then
      warn "Retrying EE build (transient failures are common)..."
      api_call POST "/admin/platform/execution-environment-build" '{"name":"AgentStore execution environment"}' > /dev/null 2>&1 || true
    else
      die "EE build failed on retry — check build log above"
    fi
  done
fi

# =============================================================================
# Phase 5 — Build Agent Runtime
# =============================================================================
phase 5 "Build Agent Runtime"

PLAT=$(api_call GET "/admin/platform") || true
RT_STATUS=$(echo "$PLAT" | jq -r '.agentRuntimeBuild.status // "none"' 2>/dev/null)

if [[ "$RESUME" == "1" && "$RT_STATUS" == "running" ]]; then
  ok "Agent runtime already built"
else
  for attempt in 1 2; do
    info "Building agent runtime container${attempt:+$([ $attempt -gt 1 ] && echo " (retry $attempt/2)")}..."
    if [[ $attempt -eq 1 ]]; then
      api_call POST "/admin/platform/agent-runtime-build" > /dev/null || die "Failed to start agent runtime build"
    fi

    poll_deploy "/admin/platform/agent-runtime-build" ".agentRuntimeBuild.status" \
      ".agentRuntimeBuild.phase" ".agentRuntimeBuild.ocpPhase" \
      "running" "failed" 600 10 "Agent runtime build" "3-5 min"

    if [[ $POLL_RC -eq 0 ]]; then
      RT_IMAGE=$(echo "$POLL_RESULT" | jq -r '.agentRuntimeBuild.image // ""' 2>/dev/null)
      RT_SHORT=$(echo "$RT_IMAGE" | grep -o 'sha256:.\{12\}' || echo "$RT_IMAGE")
      milestone "Agent runtime built (image: $RT_SHORT)"
      break
    fi

    err "Agent runtime build failed"
    BUILD_LOG=$(api_call GET "/admin/platform/agent-runtime-build/log" 2>/dev/null || echo '{"log":"(no log available)"}')
    echo "$BUILD_LOG" | jq -r '.log // ""' 2>/dev/null | tail -40 | while IFS= read -r line; do info "  $line"; done

    if [[ $attempt -eq 1 ]]; then
      warn "Retrying agent runtime build..."
      api_call POST "/admin/platform/agent-runtime-build" > /dev/null 2>&1 || true
    else
      die "Agent runtime build failed on retry — check build log above"
    fi
  done
fi

# =============================================================================
# Phase 6 — Create AAP Job Templates
# =============================================================================
phase 6 "Create AAP Job Templates"

PLAT=$(api_call GET "/admin/platform") || true
JT_AUTO=$(echo "$PLAT" | jq -r '.aapBootstrap.autonomousJobTemplateId // empty' 2>/dev/null)
JT_COLLAB=$(echo "$PLAT" | jq -r '.aapBootstrap.collaborativeJobTemplateId // empty' 2>/dev/null)

if [[ "$RESUME" == "1" && -n "$JT_AUTO" && -n "$JT_COLLAB" ]]; then
  ok "Job templates already exist (autonomous: #$JT_AUTO, collaborative: #$JT_COLLAB)"
else
  info "Creating AAP Project, Inventory, Credentials, and Job Templates..."
  api_call POST "/admin/platform/job-templates" > /dev/null || die "Failed to start AAP bootstrap"

  poll_deploy "/admin/platform/job-templates" ".aapBootstrap.status" \
    ".aapBootstrap.phase" "" \
    "running" "failed" 300 5 "AAP bootstrap" "1-2 min"

  if [[ $POLL_RC -ne 0 ]]; then
    JT_ERR=$(echo "$POLL_RESULT" | jq -r '.aapBootstrap.error // "unknown"' 2>/dev/null)
    err "AAP bootstrap failed: $JT_ERR"
    info "  Check the AAP console for partial resources"
    die "AAP bootstrap failed"
  fi

  PROJECT_ID=$(echo "$POLL_RESULT" | jq -r '.aapBootstrap.projectId // "?"' 2>/dev/null)
  JT_AUTO=$(echo "$POLL_RESULT" | jq -r '.aapBootstrap.autonomousJobTemplateId // "?"' 2>/dev/null)
  JT_COLLAB=$(echo "$POLL_RESULT" | jq -r '.aapBootstrap.collaborativeJobTemplateId // "?"' 2>/dev/null)
  milestone "AAP bootstrap complete"
  info "  Project ID:                 $PROJECT_ID"
  info "  Autonomous Job Template:    #$JT_AUTO"
  info "  Collaborative Job Template: #$JT_COLLAB"
fi

# =============================================================================
# Phase 7 — Configure LLM Provider
# =============================================================================
phase 7 "Configure LLM Provider"

# Resume check
PROVIDERS=$(api_call GET "/admin/providers") || true
ACTIVE_LLM=$(echo "$PROVIDERS" | jq -r '.[] | select(.active == true and (.models | length) > 0) | .label' 2>/dev/null | head -1)
ACTIVE_MODEL=$(echo "$PROVIDERS" | jq -r '.[] | select(.active == true) | .defaultModel // empty' 2>/dev/null | head -1)

if [[ "$RESUME" == "1" && -n "$ACTIVE_LLM" ]]; then
  ok "LLM already configured: $ACTIVE_LLM ($ACTIVE_MODEL)"
  if ! prompt_yn "Reconfigure LLM?" "N"; then
    info "Keeping existing LLM configuration"
  else
    ACTIVE_LLM=""
  fi
fi

if [[ -z "$ACTIVE_LLM" ]]; then
  MAAS_URL=""
  MAAS_KEY=""
  MODELS=""

  # Retry loop for URL + key + test
  while true; do
    echo ""
    prompt_required "MaaS / LLM inference endpoint URL" MAAS_URL "https://maas-verp.apps.cluster.example.com/v1"
    MAAS_URL="${MAAS_URL%/}"
    [[ ! "$MAAS_URL" =~ ^https:// ]] && die "URL must start with https://"
    if [[ ! "$MAAS_URL" =~ /v1$ ]]; then
      if prompt_yn "URL doesn't end with /v1 — append it?" "Y"; then
        MAAS_URL="${MAAS_URL}/v1"
      fi
    fi

    prompt_secret "API key for this endpoint" MAAS_KEY 1

    # Register provider
    PROVIDER_BODY=$(jq -n \
      --arg url "$MAAS_URL" \
      '{id:"openshift-ai-maas", kind:"openai-compatible", label:"OpenShift AI MaaS", baseUrl:$url, active:true}')
    api_call POST "/admin/providers" "$PROVIDER_BODY" > /dev/null 2>&1 || true  # may already exist

    # Set key
    api_call PATCH "/admin/providers/openshift-ai-maas/key" "{\"value\":\"$MAAS_KEY\"}" > /dev/null || die "Failed to set API key"

    # Test
    info "Connecting to LLM endpoint..."
    TEST_RESULT=$(api_call POST "/admin/providers/openshift-ai-maas/test" 2>&1) || {
      err "LLM connection failed"
      info "  • Check that the MaaS URL is correct and includes /v1"
      info "  • Check that the API key is valid"
      info "  • Ensure the endpoint is reachable from this machine"
      echo ""
      if prompt_yn "Retry with different URL/key?" "Y"; then
        continue
      else
        die "Cannot continue without LLM configuration"
      fi
    }

    MODELS=$(echo "$TEST_RESULT" | jq -r '.models // [] | .[]' 2>/dev/null)
    MODEL_COUNT=$(echo "$MODELS" | grep -c . || echo "0")

    if [[ "$MODEL_COUNT" -eq 0 ]]; then
      warn "No models discovered at this endpoint"
      if prompt_yn "Retry with different URL/key?" "Y"; then
        continue
      else
        die "Cannot continue without models"
      fi
    fi

    ok "Connected — discovered $MODEL_COUNT models"
    break
  done

  # Model selection menu
  echo ""
  echo -e "  ${C_BOLD}Select the default model for agent deployments:${C_RESET}"
  i=1
  declare -a MODEL_ARRAY=()
  while IFS= read -r m; do
    MODEL_ARRAY+=("$m")
    echo -e "    ${C_OK}$i)${C_RESET} $m"
    ((i++))
  done <<< "$MODELS"

  SELECTED_MODEL=""
  while [[ -z "$SELECTED_MODEL" ]]; do
    echo ""
    ask "Model number [1]: "
    read -r sel
    sel="${sel:-1}"
    if [[ "$sel" =~ ^[0-9]+$ && "$sel" -ge 1 && "$sel" -le "${#MODEL_ARRAY[@]}" ]]; then
      SELECTED_MODEL="${MODEL_ARRAY[$((sel - 1))]}"
    else
      err "Invalid selection — enter a number between 1 and ${#MODEL_ARRAY[@]}"
    fi
  done

  # Set default model
  api_call PATCH "/admin/providers/openshift-ai-maas" "{\"defaultModel\":\"$SELECTED_MODEL\"}" > /dev/null 2>&1 || true

  # Activate
  api_call POST "/admin/providers/openshift-ai-maas/activate" > /dev/null || true

  milestone "LLM provider configured"
  info "  Endpoint: $MAAS_URL"
  info "  Model:    $SELECTED_MODEL"
  info "  Status:   active"
fi

# =============================================================================
# Phase 8 — Install RHDH (optional)
# =============================================================================
phase 8 "Install Red Hat Developer Hub"

RHDH_ROUTE=""
if prompt_yn "Install Red Hat Developer Hub?" "Y"; then
  # Resume check
  RHDH_PRE=$(api_call GET "/admin/platform/rhdh") || true
  RHDH_INST=$(echo "$RHDH_PRE" | jq -r '.rhdhInstance.status // "none"' 2>/dev/null)
  RHDH_ROUTE=$(echo "$RHDH_PRE" | jq -r '.deploy.routeUrl // empty' 2>/dev/null)

  if [[ "$RESUME" == "1" && "$RHDH_INST" == "running" && -n "$RHDH_ROUTE" ]]; then
    ok "RHDH already running at $RHDH_ROUTE"
  else
    # Install operator
    info "Installing RHDH operator (Namespace + Subscription)..."
    api_call POST "/admin/platform/rhdh/operator" > /dev/null || die "Failed to install RHDH operator"

    poll_deploy "/admin/platform/rhdh/operator" ".rhdhDeploy.operatorStatus" \
      "" "" \
      "installed" "failed" 300 10 "RHDH operator" "2-3 min"

    if [[ $POLL_RC -ne 0 ]]; then
      OP_ERR=$(echo "$POLL_RESULT" | jq -r '.rhdhDeploy.error // "unknown"' 2>/dev/null)
      err "RHDH operator install failed: $OP_ERR"
      info "  Check OperatorHub / CatalogSource in the rhdh namespace"
      die "RHDH operator install failed"
    fi
    ok "RHDH operator installed"

    # Provision instance
    info "Provisioning RHDH instance (ConfigMaps + Backstage CR)..."
    api_call POST "/admin/platform/rhdh/instance" > /dev/null || die "Failed to provision RHDH instance"

    poll_deploy "/admin/platform/rhdh/instance" ".rhdhDeploy.instanceStatus" \
      "" "" \
      "running" "failed" 480 10 "RHDH instance" "5-8 min"

    if [[ $POLL_RC -ne 0 ]]; then
      INST_ERR=$(echo "$POLL_RESULT" | jq -r '.rhdhDeploy.error // "unknown"' 2>/dev/null)
      err "RHDH instance provision failed: $INST_ERR"
      info "  Check pods in the rhdh namespace"
      die "RHDH instance provision failed"
    fi

    RHDH_ROUTE=$(echo "$POLL_RESULT" | jq -r '.rhdhDeploy.routeUrl // empty' 2>/dev/null)
    milestone "RHDH running at $RHDH_ROUTE"
  fi
else
  info "Skipping RHDH install"
fi

# =============================================================================
# Phase 9 — OpenShell Stack (optional)
# =============================================================================
phase 9 "Install OpenShell Collaborative Agent Stack"

OPENSHELL_INSTALLED=0
if prompt_yn "Install OpenShell collaborative agent stack?" "Y"; then
  # Pre-check
  SECRETS=$(api_call GET "/admin/secrets") || true
  HAS_GH=$(echo "$SECRETS" | jq -r '.[] | select(.key == "GITHUB_PACKAGES_TOKEN") | .hasValue' 2>/dev/null)
  if [[ "$HAS_GH" != "true" ]]; then
    warn "GITHUB_PACKAGES_TOKEN not set — Agent Sandbox Service build may fail"
    if ! prompt_yn "Continue anyway?" "Y"; then
      info "Skipping OpenShell stack"
    fi
  fi

  # 1. Agent Sandbox Controller
  info "Installing Agent Sandbox Controller CRD..."
  api_call POST "/admin/platform/agent-sandbox" > /dev/null 2>&1 && ok "Agent Sandbox Controller installed" || warn "Agent Sandbox Controller install failed (may already exist)"

  # 2. OpenShell Gateway
  info "Deploying OpenShell Gateway via AAP..."
  api_call POST "/admin/platform/gateway" > /dev/null || warn "Failed to start gateway deploy"

  poll_deploy "/admin/platform/gateway" ".openshellGatewayDeployment.status" \
    "" "" \
    "running" "failed" 300 10 "OpenShell Gateway" "2-3 min"

  if [[ $POLL_RC -eq 0 ]]; then
    ok "OpenShell Gateway running"
  else
    GW_ERR=$(echo "$POLL_RESULT" | jq -r '.openshellGatewayDeployment.error // "unknown"' 2>/dev/null)
    warn "OpenShell Gateway failed: $GW_ERR"
    info "  Check the AAP job log for details"
  fi

  # 3. Agent Sandbox Service
  info "Building + deploying Agent Sandbox Service..."
  api_call POST "/admin/platform/agent-sandbox-service" > /dev/null || warn "Failed to start Agent Sandbox Service install"

  for attempt in 1 2; do
    poll_deploy "/admin/platform/agent-sandbox-service" ".agentSandboxServiceInstall.status" \
      ".agentSandboxServiceInstall.phase" ".agentSandboxServiceInstall.ocpPhase" \
      "running" "failed" 600 10 "Agent Sandbox Service" "4-6 min"

    if [[ $POLL_RC -eq 0 ]]; then
      ASS_ROUTE=$(echo "$POLL_RESULT" | jq -r '.agentSandboxServiceInstall.routeUrl // empty' 2>/dev/null)
      milestone "Agent Sandbox Service running at $ASS_ROUTE"
      OPENSHELL_INSTALLED=1
      break
    fi

    if [[ $attempt -eq 1 ]]; then
      err "Agent Sandbox Service build failed"
      warn "Retrying..."
      api_call POST "/admin/platform/agent-sandbox-service" > /dev/null 2>&1 || true
    else
      err "Agent Sandbox Service failed on retry"
    fi
  done
else
  info "Skipping OpenShell stack"
fi

# =============================================================================
# Phase 10 — Final Sync + Summary
# =============================================================================
phase 10 "Final Sync & Summary"

info "Pushing final configuration to cluster..."
SYNC_RESULT=$(api_call POST "/admin/platform/agentstore-deploy/sync" 2>&1) || true
SYNC_OK=$(echo "${SYNC_RESULT:-}" | jq -r '.ok // false' 2>/dev/null)
if [[ "$SYNC_OK" == "true" ]]; then
  ok "Final sync complete"
else
  warn "Sync failed — you can sync manually from Admin → Platform → Sync to Cluster"
fi

# Gather final status
PLAT=$(api_call GET "/admin/platform") || true
FINAL_AS_ROUTE=$(echo "$PLAT" | jq -r '.agentstoreDeploy.routeUrl // empty' 2>/dev/null)
# Derive cluster URL from console URL if not stored
if [[ -z "$FINAL_AS_ROUTE" ]]; then
  # Try API value first, then script variable from Phase 1
  CONSOLE_URL=$(echo "$PLAT" | jq -r '.openshiftConsoleUrl // empty' 2>/dev/null)
  [[ -z "$CONSOLE_URL" ]] && CONSOLE_URL="${OCP_CONSOLE:-}"
  DOMAIN=$(echo "$CONSOLE_URL" | sed -n 's|.*console-openshift-console\.\(apps\..*\)|\1|p')
  [[ -n "$DOMAIN" ]] && FINAL_AS_ROUTE="https://agentstore-agentstore.${DOMAIN}"
fi
FINAL_AS_ROUTE="${FINAL_AS_ROUTE:-N/A}"
FINAL_EE_ID="${EE_ID:-$(echo "$PLAT" | jq -r '.eeBuild.executionEnvironmentId // .aapExecutionEnvironmentId // empty' 2>/dev/null)}"
FINAL_EE_ID="${FINAL_EE_ID:-—}"
FINAL_JT_AUTO="${JT_AUTO:-$(echo "$PLAT" | jq -r '.aapBootstrap.autonomousJobTemplateId // .aapJobTemplateId // empty' 2>/dev/null)}"
FINAL_JT_AUTO="${FINAL_JT_AUTO:-—}"
FINAL_JT_COLLAB="${JT_COLLAB:-$(echo "$PLAT" | jq -r '.aapBootstrap.collaborativeJobTemplateId // .openshellGatewayJobTemplateId // empty' 2>/dev/null)}"
FINAL_JT_COLLAB="${FINAL_JT_COLLAB:-—}"

PROVIDERS=$(api_call GET "/admin/providers" 2>/dev/null) || true
FINAL_LLM=$(echo "$PROVIDERS" | jq -r '.[] | select(.active == true) | "\(.label) (\(.defaultModel // "no model"))"' 2>/dev/null | head -1)
# Override with the model the script just set if the API didn't persist it
if [[ -n "${SELECTED_MODEL:-}" && "$FINAL_LLM" == *"no model"* ]]; then
  LLM_LABEL=$(echo "$PROVIDERS" | jq -r '.[] | select(.active == true) | .label' 2>/dev/null | head -1)
  FINAL_LLM="${LLM_LABEL:-LLM} ($SELECTED_MODEL)"
fi
FINAL_LLM="${FINAL_LLM:-N/A}"

FINAL_RHDH="${RHDH_ROUTE:-— skipped}"

TOTAL_TIME=$(total_elapsed)

echo ""
echo -e "${C_BOLD}╔═══════════════════════════════════════════════════════╗${C_RESET}"
echo -e "${C_BOLD}║          AgentStore Bootstrap Complete                ║${C_RESET}"
echo -e "${C_BOLD}╚═══════════════════════════════════════════════════════╝${C_RESET}"
echo ""
echo -e "  ${C_BOLD}URLs${C_RESET}"
echo -e "    AgentStore (local):   ${C_OK}http://localhost:3000${C_RESET}"
echo -e "    AgentStore (cluster): ${C_OK}${FINAL_AS_ROUTE}${C_RESET}"
[[ -n "$RHDH_ROUTE" ]] && echo -e "    RHDH:                 ${C_OK}${FINAL_RHDH}${C_RESET}"
echo ""
echo -e "  ${C_BOLD}Status${C_RESET}"
echo -e "    ${C_OK}✓${C_RESET} AAP connected"
echo -e "    ${C_OK}✓${C_RESET} OpenShift connected"
[[ "$FINAL_EE_ID" != "—" ]] && echo -e "    ${C_OK}✓${C_RESET} EE registered (ID: $FINAL_EE_ID)" || echo -e "    ${C_DIM}— EE not registered${C_RESET}"
[[ "$FINAL_JT_AUTO" != "—" ]] && echo -e "    ${C_OK}✓${C_RESET} Job Templates: autonomous (#$FINAL_JT_AUTO) + collaborative (#$FINAL_JT_COLLAB)" || echo -e "    ${C_DIM}— Job Templates not created${C_RESET}"
echo -e "    ${C_OK}✓${C_RESET} LLM: $FINAL_LLM"
[[ -n "$RHDH_ROUTE" ]] && echo -e "    ${C_OK}✓${C_RESET} RHDH running" || echo -e "    ${C_DIM}— RHDH (skipped)${C_RESET}"
[[ $OPENSHELL_INSTALLED -eq 1 ]] && echo -e "    ${C_OK}✓${C_RESET} OpenShell stack running" || echo -e "    ${C_DIM}— OpenShell stack (skipped)${C_RESET}"
echo ""
echo -e "  ${C_BOLD}Total time:${C_RESET} ${C_MILESTONE}$TOTAL_TIME${C_RESET}"
echo ""
echo -e "  ${C_BOLD}Next steps${C_RESET}"
echo -e "    1. Open AgentStore Catalog to deploy agents"
[[ -n "$RHDH_ROUTE" ]] && echo -e "    2. In RHDH, agents appear under Self-service → Catalog"
echo ""
echo -e "  ${C_DIM}Log: $LOG_FILE${C_RESET}"
echo ""
