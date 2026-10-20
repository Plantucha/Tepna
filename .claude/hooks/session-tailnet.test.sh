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
  out="$("${envs[@]}" bash "$H" 2>&1 </dev/null)"; rc=$?
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
echo "### the WRITER survives both early exits — a 100 KB payload cannot fit the 64 KB pipe buffer"
# Every leg above reads only the hook's own exit code, and a hook that exits before it reads stdin
# still exits 0 there. This leg watches the WRITER: an unread pipe kills it with SIGPIPE (141). The
# pipe stays ON PURPOSE (a redirect has no writer to lose), and it repeats because the defect is a
# race. The assignments stay INLINE: an `env` prefix hid the writer's 141 in #3759's measurement.
# PATH names an empty directory, so no real `ts-up` can run, and bash is called by its full path.
head -c 100000 /dev/zero | tr '\0' x > "$TMP/stdin-big"
mkdir -p "$TMP/nobin"
BASH_BIN="$(command -v bash)"
writer() { # writer <key value or empty> → the worst writer exit over five laps
  local worst=0 rc i
  for i in 1 2 3 4 5; do
    cat "$TMP/stdin-big" | TS_AUTHKEY="$1" PATH="$TMP/nobin" "$BASH_BIN" "$H" >/dev/null 2>&1
    rc="${PIPESTATUS[0]}"; [ "$rc" != 0 ] && worst="$rc"
  done
  printf '%s' "$worst"
}
for leg in "no key|" "key, no helper|$KEY"; do
  w="$(writer "${leg#*|}")"
  if [ "$w" = 0 ]; then echo "  ✓ ${leg%%|*}: the writer survives"
  else echo "  ✗ ${leg%%|*}: the writer exited $w (141 = SIGPIPE, the hook never read stdin)"; fail=1; fi
done
echo "### the WIRING — a hook that is not wired is inert, however green its behaviour reads"
S="$REPO/.claude/settings.json"
wired="$(jq -r '[.hooks.SessionStart[]? | .hooks[]? | .command] | join(",")' "$S" 2>/dev/null)"
case "$wired" in
  *session-tailnet.sh*) echo "  ✓ wired under SessionStart" ;;
  *) echo "  ✗ not wired under SessionStart (commands: '$wired')"; fail=1 ;;
esac
[ "$fail" -eq 0 ] && echo "session-tailnet.test.sh: all ok" || echo "session-tailnet.test.sh: FAIL"
exit "$fail"
