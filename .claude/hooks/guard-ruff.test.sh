#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-ruff.test.sh — self-test for guard-ruff.sh.
#
# Builds a THROWAWAY repo with the real, pinned ruff (symlinked from this
# checkout's capture-host venv) and drives the hook exactly as the harness does:
# the tool-call JSON on stdin. Every DENY is paired with an ALLOW differing in ONE
# property, so a rule that fires on everything scores as loudly as one that fires
# on nothing — the discipline guard-format.test.sh established.
#
# ⚠ IF RUFF IS ABSENT THIS TEST SKIPS RATHER THAN PASSES. A green run that never
# invoked ruff would certify nothing, and "the check ran and examined nothing" is
# the failure this repo keeps paying for. Skipping says so out loud.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-ruff.sh"
REPO="$(cd "$(dirname "$H")/../.." && pwd)"
fail=0

RUFF="$REPO/capture-host/.venv/bin/ruff"
[ -x "$RUFF" ] || RUFF="$(command -v ruff 2>/dev/null || true)"
if [ -z "$RUFF" ] || [ ! -x "$RUFF" ]; then
  echo "  SKIP  guard-ruff.test.sh — no ruff available; the guard fails OPEN here and this test would certify nothing"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
W="$TMP/w"
mkdir -p "$W/capture-host/.venv/bin"
cd "$W"
git init -q .
git config user.email t@t
git config user.name t
ln -s "$RUFF" capture-host/.venv/bin/ruff          # the real, pinned ruff

# DIRTY has an unused import — the exact defect §5 records shipping twice (#852, #880).
# TIDY is the same file with the import used, so the pair differs in ONE property.
printf 'import os\n\n\ndef f():\n    return 1\n' > capture-host/dirty.py
printf 'import os\n\n\ndef f():\n    return os.sep\n' > capture-host/tidy.py
printf 'import os\n\n\ndef f():\n    return 1\n' > toplevel.py   # NOT under capture-host/
printf 'notes\n' > notes.txt
git add capture-host/tidy.py notes.txt >/dev/null
git commit -qm base

run() { # run <command> ; echoes DENY or ALLOW
  jq -nc --arg c "$1" '{tool_input:{command:$c}}' | bash "$H" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
expect() { # expect <want> <label> <command>
  local got; got="$(run "$3")"
  if [ "$got" = "$1" ]; then printf '  ok    %-58s %s\n' "$2" "$got"
  else printf '  FAIL  %-58s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}

echo "guard-ruff.sh"

# ── the core pair: identical commit, one staged file differing in lint-cleanliness ──
git add capture-host/dirty.py >/dev/null
expect DENY  "a staged capture-host .py with an unused import"   'git commit -m x'
git reset -q capture-host/dirty.py
git add capture-host/tidy.py >/dev/null
expect ALLOW "…and a clean one in the same position"             'git commit -m x'

# ── SCOPE: the guard must not lint what the commit does not contain ────────────────
# This is the property §5 warns about — a whole-tree check blocks a docs-only commit
# for a file its author never touched ("would have blocked every release").
git reset -q >/dev/null
git add notes.txt >/dev/null
expect ALLOW "a docs-only commit, with dirty .py present but UNSTAGED"  'git commit -m x'
git reset -q >/dev/null
git add toplevel.py >/dev/null
expect ALLOW "a dirty .py OUTSIDE capture-host/ is not this guard's"    'git commit -m x'

# ── it must fire on `git commit` and nothing else ──────────────────────────────────
git reset -q >/dev/null
git add capture-host/dirty.py >/dev/null
expect DENY  "plain git commit"                                  'git commit -m x'
expect ALLOW "git commit --help is not a commit"                 'git commit --help'
expect ALLOW "git commit-tree is a different command"            'git commit-tree abc'
# ⚠ DENY, not ALLOW — and this expectation was wrong first. The shared matcher fires on
# `git commit` ANYWHERE in the command line, so `echo git commit` trips it. That is an
# over-trigger on a harmless string, and it is the SAFE direction: the alternative is a
# smarter matcher that under-fires on a real commit. It is also byte-identical to
# guard-format.sh's matcher on purpose — two guards that disagree about what counts as a
# commit is a worse defect than one that occasionally denies an echo. Pinned so a future
# "improvement" to either matcher has to change this line deliberately.
expect DENY  "…including a string that merely mentions committing (over-trigger, safe)" 'echo git commit'
expect DENY  "…and a commit later in a compound command"         'npm test && git commit -m x'

# ── escape hatch, and the fail-open cases ─────────────────────────────────────────
got="$(jq -nc --arg c 'git commit -m wip' '{tool_input:{command:$c}}' | CLAUDE_ALLOW_UNFORMATTED=1 bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    CLAUDE_ALLOW_UNFORMATTED=1 lets a WIP commit through"
else echo "  FAIL  escape hatch denied"; fail=$((fail+1)); fi

got="$(printf 'not json' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    a malformed payload fails OPEN"
else echo "  FAIL  malformed payload denied"; fail=$((fail+1)); fi

# ── the message must carry the fix, not just the refusal ──────────────────────────
msg="$(jq -nc --arg c 'git commit -m x' '{tool_input:{command:$c}}' | bash "$H" 2>&1 >/dev/null)"
for want in 'ruff check --fix' 'capture-host/dirty.py' 'CLAUDE_ALLOW_UNFORMATTED=1' 'check.sh'; do
  if printf '%s' "$msg" | grep -qF "$want"; then printf '  ok    message carries %-40s\n' "$want"
  else printf '  FAIL  message missing %s\n' "$want"; fail=$((fail+1)); fi
done
# The pytest-is-not-enough line is the whole reason this guard exists (#852, #880).
if printf '%s' "$msg" | grep -qF 'GREEN pytest DOES NOT COVER THIS'; then echo "  ok    …and says a green pytest does not cover it"
else echo "  FAIL  message omits the pytest caveat"; fail=$((fail+1)); fi

# ── structural: the same two checks guard-format.test.sh pins ─────────────────────
if [ "$(tail -n1 "$H")" = "exit 2" ]; then echo "  ok    terminal statement is the DENY (exit 2)"
else echo "  FAIL  last line is '$(tail -n1 "$H")', not 'exit 2'"; fail=$((fail+1)); fi
n=$(grep -cE '^[[:space:]]*exit 0[[:space:]]*$' "$H")
if [ "$n" -ne 0 ]; then echo "  FAIL  $n unconditional bare 'exit 0' — everything below is DEAD CODE"; fail=$((fail+1))
else echo "  ok    no unconditional early exit"; fi

[ "$fail" -eq 0 ] && echo "  all guard-ruff checks passed" || echo "  $fail FAILED"
exit $((fail > 0))
