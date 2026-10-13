#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-trailer.test.sh — self-test for guard-trailer.sh.
#
# Drives the hook exactly as the harness does: the tool-call JSON on stdin, exit 2
# meaning DENY. Every DENY is paired with an ALLOW differing in ONE property, so a
# rule that fires on everything scores as loudly as one that fires on nothing — the
# same discipline as guard-format.test.sh.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-trailer.sh"
fail=0
pass=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The hook must not inherit the running session's hatch.
unset CLAUDE_ALLOW_NO_TRAILER

# ⚠ THE PAYLOAD IS FED FROM A FILE, NOT A PIPE, AND THAT IS NOT TIDINESS. The hook used to exit
# at the hatch check BEFORE reading stdin (it drains first now; the last leg pins that), so a `jq | hook` pipeline leaves jq writing to a
# closed pipe: jq dies on SIGPIPE, and under this script's `pipefail` the pipeline reports
# **141** instead of the hook's own 0. Measured while writing this test — the hatch case was
# the only one affected, because every other path reads stdin to the end. A redirect asks the
# hook what it decided; a pipe asks the pipeline, which is a different question (CLAUDE.md
# §4b: the verdict must come from the thing being judged).
run() { # run <command-string> -> prints exit code
  jq -nc --arg c "$1" '{tool_input:{command:$c}}' > "$TMP/payload.json"
  bash "$H" < "$TMP/payload.json" >/dev/null 2>&1
  printf '%s' "$?"
}
expect() { # expect <want> <label> <command>
  local want="$1" label="$2" cmd="$3" got
  got="$(run "$cmd")"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  ✕ %s — wanted exit %s, got %s\n' "$label" "$want" "$got" >&2
  fi
}

# ── -m, the simple shape ────────────────────────────────────────────────────────
expect 2 'DENY  -m without a trailer' 'git commit -m "fix: a thing"'
expect 0 'ALLOW -m with a trailer' 'git commit -m "fix: a thing

Fleet-Session: Magpie"'

# ── -F, the fleet's normal shape ────────────────────────────────────────────────
printf 'fix: no trailer here\n' > "$TMP/bare.txt"
printf 'fix: with one\n\nFleet-Session: Magpie\n' > "$TMP/ok.txt"
expect 2 'DENY  -F file without a trailer' "git commit -F $TMP/bare.txt"
expect 0 'ALLOW -F file with a trailer' "git commit -F $TMP/ok.txt"
expect 0 'ALLOW -F file with a RELAY trailer' "$(printf 'fix: x\n\nFleet-Session: Wren (relay: Magpie)\n' > "$TMP/relay.txt"; echo "git commit -F $TMP/relay.txt")"

# An empty `Fleet-Session:` is not a declaration — the `timeout-minutes: 0` shape.
printf 'fix: x\n\nFleet-Session:\n' > "$TMP/empty.txt"
expect 2 'DENY  an EMPTY Fleet-Session: is not a declaration' "git commit -F $TMP/empty.txt"

# ── the unreadable shapes FAIL OPEN ─────────────────────────────────────────────
expect 0 'ALLOW an editor commit (no -m/-F — no message exists yet)' 'git commit'
expect 0 'ALLOW -F - (stdin, which the hook cannot see)' 'git commit -F -'
expect 0 'ALLOW -F naming an unreadable path (the commit fails on its own terms)' "git commit -F $TMP/does-not-exist.txt"

# ── not a commit at all ─────────────────────────────────────────────────────────
expect 0 'ALLOW git commit-tree (not a commit)' 'git commit-tree abc123 -p def456'
expect 0 'ALLOW git commit --help' 'git commit --help'
expect 0 'ALLOW an unrelated command' 'git status --short'
expect 0 'ALLOW a command merely CONTAINING the word commit' 'echo "remember to commit"'

# ── the tree is the COMMAND's, not the hook's (--amend reads HEAD) ──────────────
W="$TMP/w"
mkdir -p "$W"
( cd "$W" && git init -q . && git config user.email t@t && git config user.name t \
  && : > a.txt && git add a.txt && git commit -q -m "seed: no trailer" ) >/dev/null 2>&1
expect 2 'DENY  --amend in a worktree whose HEAD has no trailer' "cd $W && git commit --amend --no-edit"
expect 2 'DENY  --amend via git -C, same tree' "git -C $W commit --amend --no-edit"
( cd "$W" && git commit -q --amend -m "seed: now with one

Fleet-Session: Magpie" ) >/dev/null 2>&1
expect 0 'ALLOW --amend once HEAD carries a trailer' "cd $W && git commit --amend --no-edit"
# ⚠ The pair above is the whole point: the two commands are IDENTICAL and the verdict
# flips with the tree's own HEAD, so the guard is demonstrably reading the command's
# tree rather than the hook's cwd (guard-format.sh was inert for every worktree commit
# until this was measured, 2026-09-22).

# ── the hatch ───────────────────────────────────────────────────────────────────
jq -nc --arg c 'git commit -m "no trailer"' '{tool_input:{command:$c}}' > "$TMP/hatch.json"
got="$(CLAUDE_ALLOW_NO_TRAILER=1 bash "$H" < "$TMP/hatch.json" >/dev/null 2>&1; printf '%s' "$?")"
if [ "$got" = "0" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); printf '  ✕ the hatch must allow — got %s\n' "$got" >&2; fi

# ── the refusal must SAY the fix, or it is a wall rather than a signal ──────────
jq -nc --arg c 'git commit -m "no trailer"' '{tool_input:{command:$c}}' > "$TMP/deny.json"
out="$(bash "$H" < "$TMP/deny.json" 2>&1 >/dev/null)"
for want in 'Fleet-Session: <YourName>' 'CLAUDE_ALLOW_NO_TRAILER=1' 'SELF-DECLARED'; do
  if printf '%s' "$out" | grep -qF "$want"; then pass=$((pass + 1)); else fail=$((fail + 1)); printf '  ✕ the refusal does not mention: %s\n' "$want" >&2; fi
done

# ⚠ THE HOOK MUST DRAIN STDIN BEFORE THE HATCH EXITS, AND NO LEG ABOVE CAN SEE IT. Every
# leg above reads the hook's verdict as DENY (exit 2) or ALLOW (anything else), so a hatch
# release that left the writer on a closed pipe — the harness, in production — scored as
# the ALLOW it wanted: the writer's 141 (SIGPIPE) is "not 2". This leg watches the WRITER's
# fate instead. The pipe stays ON PURPOSE (a redirect has no writer to lose), the payload is
# 100 KB so it cannot fit the 64 KB pipe buffer, and it repeats because the defect is a race.
# Same contract trim-output.test.sh pins (#3493).
head -c 100000 /dev/zero | tr '\0' x > "$TMP/stdin-big"
jq -nc --rawfile c "$TMP/stdin-big" '{tool_input:{command:$c}}' > "$TMP/stdin-big.json"
_worst=0
for _i in 1 2 3 4 5; do
  cat "$TMP/stdin-big.json" | CLAUDE_ALLOW_NO_TRAILER=1 bash "$H" >/dev/null 2>&1
  _rc="${PIPESTATUS[0]}"; [ "$_rc" != 0 ] && _worst="$_rc"
done
if [ "$_worst" = 0 ]; then pass=$((pass + 1))
else fail=$((fail + 1)); printf '  ✕ the writer into the hatched hook exited %s (141 = SIGPIPE, the hook never read it)\n' "$_worst" >&2; fi

printf '%s\n' "$([ "$fail" -eq 0 ] && printf '✓ all %s assertions passed' "$pass" || printf '✗ %s of %s assertions FAILED' "$fail" "$((pass + fail))")"
[ "$fail" -eq 0 ] || exit 1
