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

# THE HOOK MUST NOT INHERIT THE RUNNING SESSION'S HATCH. `CLAUDE_ALLOW_UNFORMATTED_RUFF=1` is documented in
# command position, and that is also the position which EXPORTS it to every child — `npm run
# check` is a child, so every DENY leg below would score ALLOW and the gate would report a
# disarmed instrument as broken legs. Measured 2026-10-21: 9 of the 11 hatch-reading
# self-tests moved from PASS to RED with their own hatch exported. Gated by
# the suite group `every hatch-reading hook has a self-test its own hatch cannot disarm`, whose
# population is `.claude/hooks/` itself. A leg that WANTS the hatch sets it inline, per leg,
# which an `unset` at the top of the file does not touch.
# ⚠ THIS ONE IS UNMEASURED HERE, NOT MEASURED CLEAN: `ruff` is absent on the rig that took the
# figure above, so this self-test SKIPPED in both arms and certified nothing either way. The line
# below is the same structure the other ten carry, asserted statically and never watched to work.
unset CLAUDE_ALLOW_UNFORMATTED_RUFF
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-ruff.sh"
# ⚠ THE WRITER-FATE PAYLOAD IS SIZED FROM THE KERNEL, NOT FROM A ROUND NUMBER. `--probe-bytes` returns
# four times this box's `fs.pipe-max-size` with a 4 MiB floor, and nothing past that ceiling can be
# absorbed into a pipe. The literal 100 KB these legs used to stage looked like twice the 64 KB pipe
# buffer, but `cat` moves a file in with `copy_file_range`, which may push pages past the 16-slot
# limit up to `fs.pipe-max-size` (1048576 here). Measured 2026-10-20 against a planted non-draining
# hook, 12 trials a size: 100 KB stranded the writer 7 times, 4000 KB 12 of 12. Re-measured the same
# day under load average 20: 100 KB stranded it 35 times of 36, one batch reading 11 of 12 — so the
# RATE is the box's scheduling at that moment, not a property of the size, and a sample cannot bound
# it. The derived size needs no rate: nothing past `fs.pipe-max-size` can be absorbed at all. A leg
# that is a coin flip on a broken hook is SILENT rather than flaky, because the hook it guards drains.
# A size that cannot be derived refuses (exit 2) — it is a leg that would examine nothing.
_PROBE_TOOL="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/tools/hook-contract.mjs"
_PROBE_BYTES="$(node "$_PROBE_TOOL" --probe-bytes 2>/dev/null)"
case "$_PROBE_BYTES" in ''|*[!0-9]*) printf '  REFUSE  the writer-fate payload size could not be derived (%s --probe-bytes)\n' "$_PROBE_TOOL" >&2; exit 2 ;; esac

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
run_from() { # run_from <cwd> <command> ; like run, but with the hook's cwd set explicitly
  ( cd "$1" && jq -nc --arg c "$2" '{tool_input:{command:$c}}' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW )
}
expect_from() { # expect_from <cwd> <want> <label> <command>
  local got; got="$(run_from "$1" "$4")"
  if [ "$got" = "$2" ]; then printf '  ok    %-58s %s\n' "$3" "$got"
  else printf '  FAIL  %-58s got %s, want %s\n' "$3" "$got" "$2"; fail=$((fail+1)); fi
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

# ── THE TREE IS THE COMMAND'S, NOT THE HOOK'S — driven from OUTSIDE the repo ──────
# Same defect guard-format.sh had, same measurement (2026-09-22): the repo was resolved
# from the hook's cwd (the session root), so `cd <wt> && git commit` was examined against
# the root's index and allowed. W2 holds only a CLEAN staged file, so each pair differs
# in the TREE alone. dirty.py is still staged in W at this point.
W2="$TMP/w2"; mkdir -p "$W2/capture-host/.venv/bin"
( cd "$W2" && git init -q . && git config user.email t@t && git config user.name t \
  && ln -s "$RUFF" capture-host/.venv/bin/ruff \
  && printf 'import os\n\n\ndef f():\n    return os.sep\n' > capture-host/tidy.py \
  && git add capture-host/tidy.py ) >/dev/null 2>&1
expect_from "$TMP" DENY  "cd <dirty repo> && git commit — cwd OUTSIDE any repo"  "cd $W && git commit -m x"
expect_from "$TMP" ALLOW "cd <clean repo> && git commit — same cwd"             "cd $W2 && git commit -m x"
expect_from "$TMP" DENY  "git -C <dirty repo> commit — cwd OUTSIDE"              "git -C $W commit -m x"
expect_from "$W2"  DENY  "git -C <dirty repo> commit — cwd inside the CLEAN repo" "git -C $W commit -m x"
expect_from "$W2"  ALLOW "…and the clean repo's own plain commit stays clean"    "git commit -m x"
expect_from "$W"   DENY  "anti-vacuity: cwd IS the dirty repo, no cd, no -C"     "git commit -m x"
expect_from "$TMP" ALLOW "RESIDUAL: no cd, no -C, cwd outside ⇒ nothing to examine" "git commit -m x"

# ── escape hatch, and the fail-open cases ─────────────────────────────────────────
got="$(jq -nc --arg c 'git commit -m wip' '{tool_input:{command:$c}}' | CLAUDE_ALLOW_UNFORMATTED_RUFF=1 bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    CLAUDE_ALLOW_UNFORMATTED_RUFF=1 lets a WIP commit through"
else echo "  FAIL  escape hatch denied"; fail=$((fail+1)); fi

got="$(printf 'not json' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    a malformed payload fails OPEN"
else echo "  FAIL  malformed payload denied"; fail=$((fail+1)); fi

# ── the message must carry the fix, not just the refusal ──────────────────────────
msg="$(jq -nc --arg c 'git commit -m x' '{tool_input:{command:$c}}' | bash "$H" 2>&1 >/dev/null)"
for want in 'ruff check --fix' 'capture-host/dirty.py' 'CLAUDE_ALLOW_UNFORMATTED_RUFF=1' 'check.sh'; do
  if printf '%s' "$msg" | grep -qF "$want"; then printf '  ok    message carries %-40s\n' "$want"
  else printf '  FAIL  message missing %s\n' "$want"; fail=$((fail+1)); fi
done
# The pytest-is-not-enough line is the whole reason this guard exists (#852, #880).
if printf '%s' "$msg" | grep -qF 'GREEN pytest DOES NOT COVER THIS'; then echo "  ok    …and says a green pytest does not cover it"
else echo "  FAIL  message omits the pytest caveat"; fail=$((fail+1)); fi

# ⚠ THE HOOK MUST DRAIN STDIN BEFORE THE HATCH EXITS, AND NO LEG ABOVE CAN SEE IT. Every
# leg above reads the hook's verdict as DENY (exit 2) or ALLOW (anything else), so a hatch
# release that left the writer on a closed pipe — the harness, in production — scored as
# the ALLOW it wanted: the writer's 141 (SIGPIPE) is "not 2". This leg watches the WRITER's
# fate instead. The pipe stays ON PURPOSE (a redirect has no writer to lose), the payload is
# sized from `fs.pipe-max-size` so the kernel cannot absorb it, and it repeats because the defect is a race.
# Same contract trim-output.test.sh pins (#3493).
head -c "$_PROBE_BYTES" /dev/zero | tr '\0' x > "$TMP/stdin-big"
jq -nc --rawfile c "$TMP/stdin-big" '{tool_input:{command:$c}}' > "$TMP/stdin-big.json"
_worst=0
for _i in 1 2 3 4 5; do
  cat "$TMP/stdin-big.json" | CLAUDE_ALLOW_UNFORMATTED_RUFF=1 bash "$H" >/dev/null 2>&1
  _rc="${PIPESTATUS[0]}"; [ "$_rc" != 0 ] && _worst="$_rc"
done
if [ "$_worst" = 0 ]; then echo "  ok    the hatch drains a payload past pipe-max, 5 writers live   rc=0"
else echo "  FAIL  the writer into the hatched hook exited $_worst (141 = SIGPIPE, the hook never read it)"; fail=$((fail+1)); fi

# ── structural: the same two checks guard-format.test.sh pins ─────────────────────
if [ "$(tail -n1 "$H")" = "exit 2" ]; then echo "  ok    terminal statement is the DENY (exit 2)"
else echo "  FAIL  last line is '$(tail -n1 "$H")', not 'exit 2'"; fail=$((fail+1)); fi
n=$(grep -cE '^[[:space:]]*exit 0[[:space:]]*$' "$H")
if [ "$n" -ne 0 ]; then echo "  FAIL  $n unconditional bare 'exit 0' — everything below is DEAD CODE"; fail=$((fail+1))
else echo "  ok    no unconditional early exit"; fi

[ "$fail" -eq 0 ] && echo "  all guard-ruff checks passed" || echo "  $fail FAILED"
exit $((fail > 0))
