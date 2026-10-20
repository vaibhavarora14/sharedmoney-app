#!/usr/bin/env bash
# Live WhatsApp OTP send+verify against local Supabase or a non-production test project.
#
# Required env:
#   WHATSAPP_TOKEN
#   TEST_RECIPIENT_PHONE   (+E.164, Meta allowlisted test recipient)
#
# Optional:
#   WHATSAPP_PHONE_NUMBER_ID (default: Meta test number 1325245927345802)
#   SUPABASE_PROJECT_REF   (default: local). Must NOT be the production ref.
#   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY  (required for non-local)
#   WHATSAPP_OTP_PEPPER    (generated for the run if unset)
#   WHATSAPP_OTP_DELIVERY  (default: text)
#   VERIFY_CODE            (6 digits; if unset, prompts interactively)
#
# Refuses the production project ref. Never prints WHATSAPP_TOKEN.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PRODUCTION_PROJECT_REF="xesuklogveedeppxbbit"

# Meta Cloud API *test* number (not secret). Token stays env-only.
DEFAULT_WHATSAPP_PHONE_NUMBER_ID="1325245927345802"
DEFAULT_WHATSAPP_WABA_ID="27639098452432498"
DEFAULT_WHATSAPP_TEST_FROM="+15556364333"

echo "== WhatsApp OTP live test (test recipients only) =="

require_set() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env: ${name}" >&2
    exit 1
  fi
  local value="${!name}"
  echo "${name}=<set, ${#value} chars>"
}

# Only the access token is required from the environment.
require_set WHATSAPP_TOKEN
require_set TEST_RECIPIENT_PHONE

WHATSAPP_PHONE_NUMBER_ID="${WHATSAPP_PHONE_NUMBER_ID:-$DEFAULT_WHATSAPP_PHONE_NUMBER_ID}"
WHATSAPP_WABA_ID="${WHATSAPP_WABA_ID:-$DEFAULT_WHATSAPP_WABA_ID}"
export WHATSAPP_PHONE_NUMBER_ID
echo "WHATSAPP_PHONE_NUMBER_ID=${WHATSAPP_PHONE_NUMBER_ID}"
echo "WHATSAPP_WABA_ID=${WHATSAPP_WABA_ID} (dashboard reference; test From ${DEFAULT_WHATSAPP_TEST_FROM})"

if [[ ! "${TEST_RECIPIENT_PHONE}" =~ ^\+[1-9][0-9]{7,14}$ ]]; then
  echo "TEST_RECIPIENT_PHONE must be E.164 (e.g. +919876543210)" >&2
  exit 1
fi
echo "TEST_RECIPIENT_PHONE=${TEST_RECIPIENT_PHONE}"

TARGET_REF="${SUPABASE_PROJECT_REF:-local}"
if [[ "${TARGET_REF}" == "${PRODUCTION_PROJECT_REF}" ]]; then
  echo "Refusing to run against production Supabase project ref (${PRODUCTION_PROJECT_REF})." >&2
  echo "Use local \`supabase start\`, or set SUPABASE_PROJECT_REF to a non-production test project." >&2
  exit 1
fi

if [[ -z "${WHATSAPP_OTP_PEPPER:-}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    WHATSAPP_OTP_PEPPER="$(openssl rand -hex 32)"
  else
    WHATSAPP_OTP_PEPPER="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  fi
  export WHATSAPP_OTP_PEPPER
  echo "WHATSAPP_OTP_PEPPER=<generated for this run>"
else
  echo "WHATSAPP_OTP_PEPPER=<set, ${#WHATSAPP_OTP_PEPPER} chars>"
fi

export ENABLE_WHATSAPP_OTP_LOGIN=true
export WHATSAPP_OTP_DELIVERY="${WHATSAPP_OTP_DELIVERY:-text}"

FUNCTIONS_BASE=""
AUTH_HEADER=""
SERVE_PID=""

cleanup() {
  if [[ -n "${SERVE_PID}" ]]; then
    kill "${SERVE_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ "${TARGET_REF}" == "local" ]]; then
  if ! command -v supabase >/dev/null 2>&1; then
    echo "supabase CLI is required for local mode" >&2
    exit 1
  fi

  echo "Ensuring local Supabase is running…"
  supabase start >/tmp/whatsapp-otp-supabase-start.log 2>&1 || true

  echo "Applying pending local migrations…"
  supabase migration up --yes >/tmp/whatsapp-otp-migration-up.log 2>&1 || \
    supabase db push --local --yes >/tmp/whatsapp-otp-db-push.log 2>&1 || true

  STATUS_JSON="$(supabase status -o json)"
  eval "$(python3 - <<'PY' "${STATUS_JSON}"
import json, sys, shlex
data = json.loads(sys.argv[1])
keys = data.get("KEYS") or data.get("keys") or {}
api_url = data.get("API_URL") or data.get("api_url") or "http://127.0.0.1:54321"
anon = data.get("ANON_KEY") or data.get("anon_key") or keys.get("anon") or ""
service = (
    data.get("SERVICE_ROLE_KEY")
    or data.get("service_role_key")
    or keys.get("service_role")
    or ""
)
print(f"API_URL={shlex.quote(api_url)}")
print(f"ANON_KEY={shlex.quote(anon)}")
print(f"SERVICE_ROLE_KEY={shlex.quote(service)}")
PY
)"

  if [[ -z "${SERVICE_ROLE_KEY}" || -z "${ANON_KEY}" ]]; then
    echo "Could not read local anon/service_role keys from supabase status." >&2
    exit 1
  fi

  export SUPABASE_URL="${API_URL}"
  export SUPABASE_ANON_KEY="${ANON_KEY}"
  export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}"
  FUNCTIONS_BASE="${API_URL%/}/functions/v1"
  AUTH_HEADER="Bearer ${SERVICE_ROLE_KEY}"

  ENV_FILE="$(mktemp)"
  cat >"${ENV_FILE}" <<EOF
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
ENABLE_WHATSAPP_OTP_LOGIN=true
WHATSAPP_OTP_DELIVERY=${WHATSAPP_OTP_DELIVERY}
WHATSAPP_OTP_PEPPER=${WHATSAPP_OTP_PEPPER}
WHATSAPP_TOKEN=${WHATSAPP_TOKEN}
WHATSAPP_PHONE_NUMBER_ID=${WHATSAPP_PHONE_NUMBER_ID}
EOF

  echo "Serving whatsapp-otp with ENABLE_WHATSAPP_OTP_LOGIN=true WHATSAPP_OTP_DELIVERY=${WHATSAPP_OTP_DELIVERY}…"
  pkill -f "supabase functions serve" 2>/dev/null || true
  sleep 1
  supabase functions serve whatsapp-otp --env-file "${ENV_FILE}" \
    >/tmp/whatsapp-otp-functions-serve.log 2>&1 &
  SERVE_PID=$!
  sleep 4
else
  require_set SUPABASE_URL
  require_set SUPABASE_SERVICE_ROLE_KEY
  if [[ "${SUPABASE_URL}" == *"${PRODUCTION_PROJECT_REF}"* ]]; then
    echo "Refusing production SUPABASE_URL containing ${PRODUCTION_PROJECT_REF}." >&2
    exit 1
  fi
  FUNCTIONS_BASE="${SUPABASE_URL%/}/functions/v1"
  AUTH_HEADER="Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
  echo "Targeting non-production project: ${TARGET_REF}"
  echo "Ensure that project has ENABLE_WHATSAPP_OTP_LOGIN=true, WHATSAPP_OTP_DELIVERY=text,"
  echo "WhatsApp secrets + pepper set, and migration 20261020120000 applied (not production)."
fi

echo "POST ${FUNCTIONS_BASE}/whatsapp-otp action=send"
SEND_BODY="$(mktemp)"
SEND_HTTP="$(curl -sS -o "${SEND_BODY}" -w "%{http_code}" \
  -X POST "${FUNCTIONS_BASE}/whatsapp-otp" \
  -H "Content-Type: application/json" \
  -H "Authorization: ${AUTH_HEADER}" \
  -d "{\"action\":\"send\",\"phone\":\"${TEST_RECIPIENT_PHONE}\"}")"
echo "send HTTP ${SEND_HTTP}"
python3 - <<PY
import json, sys
from pathlib import Path
raw = Path("${SEND_BODY}").read_text()
data = json.loads(raw)
print({k: data.get(k) for k in ("sent", "delivery", "expires_in", "resend_after", "error", "code")})
sys.exit(0 if int("${SEND_HTTP}") < 400 and data.get("sent") else 1)
PY

if [[ -n "${VERIFY_CODE:-}" ]]; then
  CODE="${VERIFY_CODE}"
else
  read -r -p "Enter the 6-digit WhatsApp code received on ${TEST_RECIPIENT_PHONE}: " CODE
fi

if [[ ! "${CODE}" =~ ^[0-9]{6}$ ]]; then
  echo "Code must be exactly 6 digits" >&2
  exit 1
fi

echo "POST ${FUNCTIONS_BASE}/whatsapp-otp action=verify"
VERIFY_BODY="$(mktemp)"
VERIFY_HTTP="$(curl -sS -o "${VERIFY_BODY}" -w "%{http_code}" \
  -X POST "${FUNCTIONS_BASE}/whatsapp-otp" \
  -H "Content-Type: application/json" \
  -H "Authorization: ${AUTH_HEADER}" \
  -d "{\"action\":\"verify\",\"phone\":\"${TEST_RECIPIENT_PHONE}\",\"code\":\"${CODE}\"}")"
echo "verify HTTP ${VERIFY_HTTP}"
python3 - <<PY
import json, sys
from pathlib import Path
raw = Path("${VERIFY_BODY}").read_text()
data = json.loads(raw)
safe = {
    "verified": data.get("verified"),
    "error": data.get("error"),
    "code": data.get("code"),
    "user_id": (data.get("user") or {}).get("id"),
    "has_session": bool((data.get("session") or {}).get("access_token")),
}
print(safe)
ok = int("${VERIFY_HTTP}") < 400 and bool(data.get("verified")) and safe["has_session"]
if not ok:
    sys.exit(1)
print("OK: WhatsApp OTP send+verify succeeded (session minted).")
PY
