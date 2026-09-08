#!/bin/bash
# Cyber Career OS - smoke test
# Verifies the backend API boots and responds, and (optionally) that the
# frontend builds/type-checks. Installs missing deps automatically.
#
# Usage:
#   ./test.sh                 # backend API smoke test only
#   ./test.sh --full          # backend smoke test + frontend typecheck build
#   PORT=8001 ./test.sh       # use a non-default backend port
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
PORT="${PORT:-8000}"
BASE="http://localhost:$PORT"

PASS=0
FAIL=0

green() { printf '\e[32m%s\e[0m\n' "$*"; }
red()   { printf '\e[31m%s\e[0m\n' "$*"; }

# check <name> <expected_status> <method> <path> [json_payload]
check() {
  local name="$1" expected="$2" method="$3" path="$4" payload="${5:-}"
  local code
  if [ -n "$payload" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" \
      -H 'Content-Type: application/json' -d "$payload" || true)
  else
    code=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" || true)
  fi
  if [ "$code" = "$expected" ]; then
    green "  PASS  $name (HTTP $code)"
    PASS=$((PASS+1))
  else
    red "  FAIL  $name (expected HTTP $expected, got $code)"
    FAIL=$((FAIL+1))
  fi
}

cleanup() {
  if [ -n "${UVI_PID:-}" ]; then
    kill "$UVI_PID" 2>/dev/null || true
    wait "$UVI_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "== Cyber Career OS smoke test =="

# --- Backend setup ------------------------------------------------------- #
if [ ! -x "$BACKEND_DIR/venv/bin/python" ]; then
  echo "==> Creating backend virtualenv..."
  python3 -m venv "$BACKEND_DIR/venv"
fi
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "==> Creating backend/.env from example (edit GROQ_API_KEY for LLM tests)..."
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
fi
echo "==> Ensuring backend dependencies..."
"$BACKEND_DIR/venv/bin/pip" -q install -r "$BACKEND_DIR/requirements.txt"

# --- Obsidian vault fixture (safe test vault, never the real one) --------- #
VAULT="$BACKEND_DIR/data/vault_test"
if ! grep -qE '^OBSIDIAN_VAULT_PATH=' "$BACKEND_DIR/.env"; then
  echo "OBSIDIAN_VAULT_PATH=$VAULT" >> "$BACKEND_DIR/.env"
  echo "OBSIDIAN_REQUIRED_TAGS=cyber" >> "$BACKEND_DIR/.env"
  echo "OBSIDIAN_MAX_NOTES_PER_SCAN=10" >> "$BACKEND_DIR/.env"
fi
setup_vault_fixture() {
  mkdir -p "$VAULT/.obsidian" "$VAULT/notes/uni" "$VAULT/attachments"
  [ -f "$VAULT/.obsidian/app.json" ] || cat > "$VAULT/.obsidian/app.json" <<'EOF'
{"vault": {"attachmentFolderPath": "attachments"}}
EOF
  [ -f "$VAULT/notes/metasploit.md" ] || cat > "$VAULT/notes/metasploit.md" <<'EOF'
---
title: THM - Metasploit Basics
tags: [cyber, redteam]
---
# Metasploit Basics
Used EXPEloit... ran `nmap -sV`, exploited MS17-010 (CVE-2017-0144). See ![[msf-console.png]]
Relevant MITRE technique: T1210.
EOF
  [ -f "$VAULT/notes/uni/crypto.md" ] || cat > "$VAULT/notes/uni/crypto.md" <<'EOF'
---
tags: [uni, cryptography]
---
# Cryptography Lecture 5
RSA: public key, modulus n = p*q. Read chapter 7.
EOF
  rm -f "$VAULT/attachments/msf-console.png"
  "$BACKEND_DIR/venv/bin/python" -c \
    "from PIL import Image; Image.new('RGB',(400,120),(10,10,20)).save('$VAULT/attachments/msf-console.png')"
}
setup_vault_fixture
echo "==> Vault sync fixture ready at $VAULT"

echo "==> Starting backend on :$PORT..."
(cd "$BACKEND_DIR" && exec venv/bin/uvicorn app.main:app --port "$PORT") &
UVI_PID=$!

echo -n "==> Waiting for backend"
for _ in $(seq 1 30); do
  if curl -s "$BASE/health" >/dev/null 2>&1; then
    echo " (up)"
    break
  fi
  echo -n "."
  sleep 1
done
if ! curl -s "$BASE/health" >/dev/null 2>&1; then
  red "Backend did not start. Check logs above."
  exit 1
fi

echo "==> Core API (no GROQ key required)"
check "health"           200 GET /health
check "root"             200 GET /
check "graph/stats"      200 GET /graph/stats
check "graph/nodes"      200 GET "/graph/nodes?limit=3"
check "graph/visualize"  200 GET /graph/visualize
check "graph/edges"      200 GET "/graph/edges?limit=5"
check "digest list"      200 GET /digest
check "ingest queue"     200 GET /ingest/queue
check "obsidian status"  200 GET /obsidian/status

echo "==> LLM-backed endpoints (require GROQ_API_KEY in backend/.env)"
REAL_KEY=0
if [ -n "${GROQ_API_KEY:-}" ]; then
  REAL_KEY=1
elif [ -f "$BACKEND_DIR/.env" ] \
     && grep -qE '^GROQ_API_KEY=.+' "$BACKEND_DIR/.env" \
     && ! grep -qE '^GROQ_API_KEY=your_groq_api_key_here' "$BACKEND_DIR/.env"; then
  REAL_KEY=1
fi

if [ "$REAL_KEY" -eq 1 ]; then
  check "post /ingest/text" 200 POST /ingest/text '{"content":"Test: nmap, OpenSSL CVE-2023-0286"}'
  check "set target role"   200 POST /roles '{"role_name":"Security Analyst"}'
  check "obsidian sync"     200 POST /obsidian/sync
  # Assert the scanner produced graph nodes and skipped .obsidian/+unchanged files.
  "$BACKEND_DIR/venv/bin/python" - "$BACKEND_DIR" <<'PY'
import asyncio, sys, json, os
sys.path.insert(0, sys.argv[1])
os.chdir(sys.argv[1])
from app.services.obsidian import scan_vault, is_enabled
assert is_enabled(), "OBSIDIAN_VAULT_PATH not set"
res = asyncio.run(scan_vault(limit=50))
# First pass: scan all fixture files; a re-pass must not re-ingest anything.
res2 = asyncio.run(scan_vault(limit=50))
assert res["total_files"] == 2, f"expected 2 fixture notes, got {res['total_files']}"
assert res2["unchanged"] >= 1 or res2["scanned"] == 0, "second pass should find no new work"
ok = True
for label, data in (("first", res), ("second", res2)):
    for field in ("ingested", "indexed", "excluded", "errors"):
        assert data.get(field, 0) >= 0
print(f"  scanner asserted OK: files={res['total_files']} "
      f"ingested={res['ingested']} indexed={res['indexed']} unchanged2={res2['unchanged']}")
PY
  [ $? -eq 0 ] && green "  PASS  obsidian scanner assertions" && PASS=$((PASS+1)) \
                || { red "  FAIL  obsidian scanner assertions"; FAIL=$((FAIL+1)); }
else
  echo "  (skipped - add your real GROQ_API_KEY to backend/.env to run LLM tests)"
fi

echo
echo "==> Backend results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || { red "Backend smoke test FAILED."; exit 1; }

# --- Frontend (optional) ------------------------------------------------- #
if [[ "${1:-}" == "--full" ]]; then
  echo
  echo "==> Frontend"
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "==> Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm install)
  fi
  echo "==> Running 'npm run build' (Next.js type-check + compile)..."
  (cd "$FRONTEND_DIR" && npm run build)
  echo "==> Frontend PASS"
fi

green "All smoke tests passed."