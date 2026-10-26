#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-format.test.sh — self-test for guard-format.sh.
#
# Builds a THROWAWAY repo with a real Biome install (symlinked from this checkout)
# and drives the hook exactly as the harness does: the tool-call JSON on stdin.
# Every DENY is paired with an ALLOW differing in ONE property, so a rule that
# fires on everything scores as loudly as one that fires on nothing.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# THE HOOK MUST NOT INHERIT THE RUNNING SESSION'S HATCH. `CLAUDE_ALLOW_UNFORMATTED_FORMAT=1` is documented in
# command position, and that is also the position which EXPORTS it to every child — `npm run
# check` is a child, so every DENY leg below would score ALLOW and the gate would report a
# disarmed instrument as broken legs. Measured 2026-10-21: 9 of the 11 hatch-reading
# self-tests moved from PASS to RED with their own hatch exported. Gated by
# the suite group `every hatch-reading hook has a self-test its own hatch cannot disarm`, whose
# population is `.claude/hooks/` itself. A leg that WANTS the hatch sets it inline, per leg,
# which an `unset` at the top of the file does not touch.
unset CLAUDE_ALLOW_UNFORMATTED_FORMAT
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-format.sh"
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

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
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
  cat "$TMP/stdin-big.json" | CLAUDE_ALLOW_UNFORMATTED_FORMAT=1 bash "$H" >/dev/null 2>&1
  _rc="${PIPESTATUS[0]}"; [ "$_rc" != 0 ] && _worst="$_rc"
done
if [ "$_worst" = 0 ]; then echo "  ok    the hatch drains a payload past pipe-max, 5 writers live   rc=0"
else echo "  FAIL  the writer into the hatched hook exited $_worst (141 = SIGPIPE, the hook never read it)"; fail=$((fail+1))
  # This leg sits ABOVE the Biome SKIP (it needs no Biome), and the SKIP exits 0, so a failure here must leave now.
  echo "FAIL — $fail problem(s)"; exit 1; fi

W="$TMP/w"
mkdir -p "$W"
cd "$W"
git init -q .
git config user.email t@t
git config user.name t
cp "$REPO/biome.json" .

# ⚠ THIS HARNESS HAD THE DEFECT IT TESTS FOR. `ln -s "$REPO/node_modules"` is a
# DANGLING symlink in a fresh worktree — which is the checkout CLAUDE.md §👥.1
# mandates — so Biome silently was not there, every DENY case scored ALLOW, and the
# run reported NINE failures that read as "the hook is broken". Measured 2026-09-22
# while building the fix for exactly that blind spot. So resolve Biome the way the
# hook now does (this checkout → $DEX_BIOME → the PRIMARY checkout, derived from git),
# and SKIP loudly rather than reporting false failures if it is genuinely absent.
_common="$(cd "$REPO" && git rev-parse --git-common-dir 2>/dev/null)"
case "${_common:-}" in
  /*) _PRIMARY="$(dirname "$_common")" ;;
  '') _PRIMARY='' ;;
  *)  _PRIMARY="$(cd "$REPO" && cd "$(dirname "$_common")" 2>/dev/null && pwd)" ;;
esac
NM=''
for _c in "$REPO/node_modules" "${DEX_BIOME:+$(dirname "$(dirname "${DEX_BIOME}")")}" "${_PRIMARY:+$_PRIMARY/node_modules}"; do
  [ -n "$_c" ] && [ -x "$_c/.bin/biome" ] && { NM="$_c"; break; }
done
if [ -z "$NM" ]; then
  echo "  SKIP  guard-format.test.sh — no pinned Biome reachable; this test would certify nothing"
  echo "        looked in: $REPO/node_modules · \$DEX_BIOME · ${_PRIMARY:-<no primary>}/node_modules"
  exit 0
fi
ln -s "$NM" node_modules                         # the real, pinned Biome

# UGLY is unformatted (Biome reflows it); TIDY is what Biome emits for the same code.
printf 'export const a = {b:1,   c:2};\n' > ugly.js
printf 'export const a = { b: 1, c: 2 };\n' > tidy.js
printf 'not javascript at all\n' > notes.txt
git add tidy.js notes.txt >/dev/null
git commit -qm base

run() { # run <command> ; echoes DENY or ALLOW
  jq -nc --arg c "$1" '{tool_input:{command:$c}}' | bash "$H" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
expect() { # expect <want> <label> <command>
  local got; got="$(run "$3")"
  if [ "$got" = "$1" ]; then printf '  ok    %-56s %s\n' "$2" "$got"
  else printf '  FAIL  %-56s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}
run_from() { # run_from <cwd> <command> ; like run, but with the hook's cwd set explicitly
  ( cd "$1" && jq -nc --arg c "$2" '{tool_input:{command:$c}}' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW )
}
expect_from() { # expect_from <cwd> <want> <label> <command>
  local got; got="$(run_from "$1" "$4")"
  if [ "$got" = "$2" ]; then printf '  ok    %-56s %s\n' "$3" "$got"
  else printf '  FAIL  %-56s got %s, want %s\n' "$3" "$got" "$2"; fail=$((fail+1)); fi
}

echo "### the case it exists for"
git add ugly.js >/dev/null
expect DENY  "an unformatted .js is STAGED"                    "git commit -m wip"
expect DENY  "…and through a -C form"                          "git -C . commit -m wip"
expect DENY  "…and when it is not the first word"              "cd \"$W\" && git commit -m wip"

echo
echo "### the paired ALLOWs — each differs in exactly ONE property"
# Same file, same content, same repo — but NOT staged. Staging is the only difference.
git restore --staged ugly.js >/dev/null 2>&1 || git reset -q HEAD ugly.js
expect ALLOW "the same ugly file is UNSTAGED — not this commit's problem"  "git commit -m wip"
git add tidy.js >/dev/null
expect ALLOW "a staged file that IS formatted"                 "git commit -m ok"
git add notes.txt >/dev/null
expect ALLOW "a staged NON-js file is out of scope"            "git commit -m ok"
# Staged and ugly again — so the ALLOWs below differ only in the COMMAND.
git add ugly.js >/dev/null
expect ALLOW "not a commit at all"                             "git status --short"
expect ALLOW "git commit-tree is not git commit"               "git commit-tree \$TREE -m x"
expect ALLOW "asking for help never commits"                   "git commit --help"

echo
echo "### THE TREE IS THE COMMAND'S, NOT THE HOOK'S — driven from OUTSIDE the repo"
# The hook runs with the SESSION's cwd (the shared root, for nearly every session);
# the commit runs wherever the command sends it, and §👥.1 sends it to a worktree.
# Before this leg the guard resolved the repo from its own cwd and examined the ROOT's
# index for a worktree commit — inert for every `cd <wt> && git commit`, measured
# 2026-09-22 with a staged unformatted plant that committed straight through.
# W2 is a second repo with only a TIDY file staged, so each pair differs in the TREE alone.
W2="$TMP/w2"; mkdir -p "$W2"
( cd "$W2" && git init -q . && git config user.email t@t && git config user.name t \
  && cp "$REPO/biome.json" . && ln -s "$NM" node_modules \
  && printf 'export const a = { b: 1, c: 2 };\n' > tidy.js && git add tidy.js ) >/dev/null 2>&1
expect_from "$TMP" DENY  "cd <ugly repo> && git commit — cwd OUTSIDE any repo"   "cd $W && git commit -m wip"
expect_from "$TMP" ALLOW "cd <tidy repo> && git commit — same cwd"              "cd $W2 && git commit -m ok"
expect_from "$TMP" DENY  "…the cd target quoted"                                "cd \"$W\" && git commit -m wip"
expect_from "$TMP" DENY  "git -C <ugly repo> commit — cwd OUTSIDE"               "git -C $W commit -m wip"
expect_from "$W2"  DENY  "git -C <ugly repo> commit — cwd inside the TIDY repo"  "git -C $W commit -m wip"
expect_from "$W2"  ALLOW "…and the tidy repo's own plain commit stays clean"     "git commit -m ok"
expect_from "$W"   DENY  "anti-vacuity: cwd IS the ugly repo, no cd, no -C"      "git commit -m wip"
# Two RESIDUALS, pinned so they are known rather than discovered: with nothing in the
# command naming a tree, the hook's cwd is all there is; and a tree the same command
# CREATES does not exist at PreToolUse time, so there is nothing to ask.
expect_from "$TMP" ALLOW "RESIDUAL: no cd, no -C, cwd outside ⇒ nothing to examine" "git commit -m wip"
expect_from "$TMP" ALLOW "RESIDUAL: cd to a tree the command creates ⇒ fallback"   "git worktree add $TMP/nope && cd $TMP/nope && git commit -m wip"

echo
echo "### escape hatch + degenerate inputs"
got="$(jq -nc --arg c 'git commit -m wip' '{tool_input:{command:$c}}' | CLAUDE_ALLOW_UNFORMATTED_FORMAT=1 bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    CLAUDE_ALLOW_UNFORMATTED_FORMAT=1 releases it"
else echo "  FAIL  escape hatch did not release"; fail=$((fail+1)); fi
expect ALLOW "no command in the payload"                       ""
got="$(printf 'not json' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    malformed payload fails OPEN"
else echo "  FAIL  malformed payload denied"; fail=$((fail+1)); fi

echo
echo "### FAILS OPEN without Biome — the fresh-worktree case that decides usability"
# A worktree has no node_modules (gitignored). A guard that blocked every commit there
# would be switched off within a day, and it guards formatting, not an invariant.
rm node_modules
expect ALLOW "no node_modules ⇒ ALLOW (CI is the backstop)"    "git commit -m wip"
ln -s "$NM" node_modules
expect DENY  "…and it comes straight back when Biome returns"  "git commit -m wip"

echo
echo "### the message names the files AND the fix"
msg="$(jq -nc --arg c 'git commit -m wip' '{tool_input:{command:$c}}' | bash "$H" 2>&1 >/dev/null)"
for want in "ugly.js" "biome format --write" "CLAUDE_ALLOW_UNFORMATTED" "REQUIRED check"; do
  if grep -qF -- "$want" <<<"$msg"; then echo "  ok    message carries '$want'"
  else echo "  FAIL  message missing '$want'"; fail=$((fail+1)); fi
done

echo
echo "### the WIRING — a hook that is not wired is inert, however green its behaviour reads"
S="$REPO/.claude/settings.json"
if [ -f "$S" ]; then
  wired="$(jq -r --arg h guard-format.sh '[.hooks.PreToolUse[]? | select(any(.hooks[]?; .command | test($h))) | .matcher] | join(",")' "$S" 2>/dev/null)"
  case "$wired" in
    *Bash*) echo "  ok    wired for Bash" ;;
    *) echo "  FAIL  not wired for Bash (matchers: '$wired')"; fail=$((fail+1)) ;;
  esac
else
  echo "  FAIL  .claude/settings.json not found at $S"; fail=$((fail+1))
fi

echo
echo "### a WORKTREE without node_modules — the guard now FINDS Biome instead of going silent"
# The case the whole change exists for, exercised as a REAL worktree rather than by
# deleting a symlink: 20 of 58 worktrees on this box had no node_modules when this was
# written, and a worktree is what §👥.1 tells every session to make.
git -C "$W" worktree add -q "$TMP/wt" -b wtbranch >/dev/null 2>&1
if [ -d "$TMP/wt" ]; then
  cp "$REPO/biome.json" "$TMP/wt/" 2>/dev/null
  printf 'export const a = {b:1,   c:2};\n' > "$TMP/wt/ugly2.js"
  git -C "$TMP/wt" add ugly2.js >/dev/null 2>&1
  [ -e "$TMP/wt/node_modules" ] && echo "  FAIL  the test worktree has node_modules; it cannot exercise the case" && fail=$((fail+1))
  got="$(cd "$TMP/wt" && jq -nc --arg c 'git commit -m wip' '{tool_input:{command:$c}}' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
  if [ "$got" = DENY ]; then echo "  ok    no node_modules in the worktree, and it still DENIES — found the primary's Biome"
  else echo "  FAIL  worktree commit got $got, want DENY (the search did not reach the primary)"; fail=$((fail+1)); fi
else
  echo "  SKIP  could not create a test worktree"
fi

echo
echo "### Biome genuinely unreachable — ALLOW, but SAY so, and say it ONCE"
# Absent and clean must not look identical. The notice is the whole point; it must not
# become a denial, and it must not repeat on every commit.
mk="$TMP/marker-home"; mkdir -p "$mk"
# ⚠ THE EXIT CODE TRAVELS IN THE OUTPUT, NOT IN `$?` AFTER THE CAPTURE. A function whose
# last statement is a `printf` returns PRINTF's status, so `first="$(absent)"; first_ec=$?`
# read 0 whatever the hook did, and the "never a denial" leg below could never fail. The
# comment above it records a first draft asserting the wrong command's code; the rewrite
# moved the defect instead of removing it. Measured 2026-10-26 beside the ruff sibling.
absent() { # absent ; echoes "<exit-code>|<notice-lines>"
  local ec
  out="$(cd "$W" && TMPDIR="$mk" CLAUDE_CODE_SESSION_ID=tsess DEX_BIOME=/nonexistent/biome \
        env PATH="$PATH" bash -c 'mv node_modules nm.hidden 2>/dev/null; jq -nc --arg c "git commit -m wip" "{tool_input:{command:\$c}}" | bash '"$H"' 2>&1 >/dev/null; ec=$?; mv nm.hidden node_modules 2>/dev/null; exit $ec')"; ec=$?
  printf '%s|%s' "$ec" "$out"
}
first="$(absent)"; first_ec="${first%%|*}"; first="${first#*|}"
if printf '%s' "$first" | grep -qF 'was NOT format-checked'; then echo "  ok    absent Biome SAYS so — not a silent pass"
else echo "  FAIL  absent Biome produced no notice"; fail=$((fail+1)); fi
if printf '%s' "$first" | grep -qF 'Looked for it at:'; then echo "  ok    …and prints WHERE it looked, so 'absent' is checkable"
else echo "  FAIL  notice does not say where it looked"; fail=$((fail+1)); fi
second="$(absent)"; second="${second#*|}"
if [ -z "$second" ]; then echo "  ok    …and says it ONCE per session, not on every commit"
else echo "  FAIL  the notice repeated"; fail=$((fail+1)); fi
# ⚠ Assert the EXIT CODE of the absent run itself — not a fresh `expect`, which runs with
# node_modules restored and would correctly DENY. A first draft did exactly that and failed,
# which is the harness testing a different command than the one under test.
if [ "$first_ec" -eq 0 ]; then echo "  ok    …and it is a NOTICE, never a denial (exit 0)"
else echo "  FAIL  absent Biome exited $first_ec, want 0 — it must never deny"; fail=$((fail+1)); fi

echo
echo "### file integrity"
if [ "$(tail -n1 "$H")" = "exit 2" ]; then echo "  ok    terminal statement is the DENY (exit 2)"
else echo "  FAIL  last line is '$(tail -n1 "$H")', not 'exit 2'"; fail=$((fail+1)); fi
n=$(grep -cE '^[[:space:]]*exit 0[[:space:]]*$' "$H")
if [ "$n" -ne 0 ]; then echo "  FAIL  $n unconditional bare 'exit 0' — everything below is DEAD CODE"; fail=$((fail+1))
else echo "  ok    no unconditional early exit"; fi
bash -n "$H" && echo "  ok    syntax"

echo
[ "$fail" -eq 0 ] && echo "PASS — every DENY paired with an ALLOW that differs in one property" \
                  || echo "FAIL — $fail problem(s)"
exit $((fail > 0))
