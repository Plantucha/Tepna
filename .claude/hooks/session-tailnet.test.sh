#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# session-tailnet.test.sh — self-test for session-tailnet.sh.
#
# Drives the hook under `env -i` with a throwaway PATH, so the ONLY `ts-up` it can find is the
# fake this test plants, and the only key it can see is the fake this test sets. Every "joins"
# case is paired with an "inert" case that differs in ONE property (key present/absent, helper
# present/absent), and every case asserts the key's value is absent from the hook's output.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/session-tailnet.sh"
REPO="$(cd "$(dirname "$H")/../.." && pwd)"
fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
KEY="not-a-real-key-TESTONLY-4f9c2a"

run() { # run <with_key:0|1> <helper:none|ok|fail>  → prints "<rc>|<combined output>"
  local envs=(env -i PATH="$TMP/bin:/usr/bin:/bin") out rc
  rm -f "$TMP/bin/ts-up"
  case "$2" in
    ok)   printf '#!/bin/sh\necho "ts-up: up"\n' > "$TMP/bin/ts-up"; chmod +x "$TMP/bin/ts-up" ;;
    fail) printf '#!/bin/sh\necho "ts-up: failed 1 (see the log)"\nexit 1\n' > "$TMP/bin/ts-up"; chmod +x "$TMP/bin/ts-up" ;;
  esac
  [ "$1" = 1 ] && envs+=(TS_AUTHKEY="$KEY")
  out="$("${envs[@]}" bash "$H" 2>&1)"; rc=$?
  printf '%s|%s' "$rc" "$out"
}
check() { # check <label> <run-result> <want_rc> <want_substring | EMPTY>
  local rc="${2%%|*}" out="${2#*|}"
  if [ "$rc" != "$3" ]; then echo "  ✗ $1 — exit $rc, wanted $3"; fail=1; return; fi
  if [ "$4" = EMPTY ]; then
    if [ -z "$out" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — wanted silence, got: $out"; fail=1; fi
  else
    case "$out" in *"$4"*) echo "  ✓ $1" ;; *) echo "  ✗ $1 — wanted '$4' in: $out"; fail=1 ;; esac
  fi
  case "$out" in *"$KEY"*) echo "  ✗ $1 — THE KEY LEAKED INTO THE OUTPUT"; fail=1 ;; esac
}

echo "### inert without the key, whatever is on PATH"
check "no key, no helper"        "$(run 0 none)" 0 EMPTY
check "no key, helper present"   "$(run 0 ok)"   0 EMPTY
echo "### inert without the helper, even with the key"
check "key, no helper"           "$(run 1 none)" 0 EMPTY
echo "### joins when both are present — one line, exit 0 either way, the key never printed"
check "key + helper succeeds"    "$(run 1 ok)"   0 "session-tailnet: ts-up: up"
check "key + helper fails"       "$(run 1 fail)" 0 "session-tailnet: join FAILED"
echo "### the WIRING — a hook that is not wired is inert, however green its behaviour reads"
S="$REPO/.claude/settings.json"
wired="$(jq -r '[.hooks.SessionStart[]? | .hooks[]? | .command] | join(",")' "$S" 2>/dev/null)"
case "$wired" in
  *session-tailnet.sh*) echo "  ✓ wired under SessionStart" ;;
  *) echo "  ✗ not wired under SessionStart (commands: '$wired')"; fail=1 ;;
esac
[ "$fail" -eq 0 ] && echo "session-tailnet.test.sh: all ok" || echo "session-tailnet.test.sh: FAIL"
exit "$fail"
