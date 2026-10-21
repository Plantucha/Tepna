#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# trim-output.test.sh — self-test for trim-output.sh.
#
# It drives the hook exactly as the harness does: the tool-call JSON on stdin. Every
# WRAP is paired with a PASS-THROUGH that differs in ONE property, so a rule that fires
# on everything scores as loudly as a rule that fires on nothing. That is the discipline
# guard-format.test.sh established, and it is the whole value of this file: a rewriter
# that wrapped every command would pass a test that only asserted wrapping.
#
# It also RUNS the rewritten command. A rewriter whose output text looks right and whose
# exit code is wrong would corrupt every verdict this repo reads, so the exit code gets
# its own leg.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# THE HOOK MUST NOT INHERIT THE RUNNING SESSION'S HATCH. `CLAUDE_ALLOW_UNTRIMMED=1` is documented in
# command position, and that is also the position which EXPORTS it to every child — `npm run
# check` is a child, so every DENY leg below would score ALLOW and the gate would report a
# disarmed instrument as broken legs. Measured 2026-10-21: 9 of the 11 hatch-reading
# self-tests moved from PASS to RED with their own hatch exported. Gated by
# the suite group `every hatch-reading hook has a self-test its own hatch cannot disarm`, whose
# population is `.claude/hooks/` itself. A leg that WANTS the hatch sets it inline, per leg,
# which an `unset` at the top of the file does not touch.
unset CLAUDE_ALLOW_UNTRIMMED
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/trim-output.sh"
# ⚠ THE WRITER-FATE PAYLOAD IS SIZED FROM THE KERNEL, NOT FROM A ROUND NUMBER. `--probe-bytes` returns
# four times this box's `fs.pipe-max-size` with a 4 MiB floor, and nothing past that ceiling can be
# absorbed into a pipe. The 70 KB this file used to stage looked like more than the 64 KB pipe buffer,
# but `cat` moves a file in with `copy_file_range`, which may push pages past the 16-slot limit up to
# `fs.pipe-max-size` (1048576 here). Measured 2026-10-20 against a planted non-draining hook, 12 trials
# a size: 100 KB stranded the writer 7 times, 4000 KB 12 of 12; re-measured the same day under load
# average 20, 100 KB stranded it 35 times of 36. The RATE is the box's scheduling at that moment, so
# the pre-fix 5-of-5 reading below is a run the derived payload makes certain rather than likely.
# A size that cannot be derived refuses (exit 2) — it is a leg that would examine nothing.
_PROBE_TOOL="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/tools/hook-contract.mjs"
_PROBE_BYTES="$(node "$_PROBE_TOOL" --probe-bytes 2>/dev/null)"
case "$_PROBE_BYTES" in ''|*[!0-9]*) printf '  REFUSE  the writer-fate payload size could not be derived (%s --probe-bytes)\n' "$_PROBE_TOOL" >&2; exit 2 ;; esac

fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ⚠ THE PAYLOAD IS FED BY REDIRECT, NOT BY A PIPE. `jq | hook` reports the PIPELINE's
# code, and under this script's `pipefail` that is the writer's 141 whenever the hook
# exits before draining stdin — a different question from what the hook decided
# (CLAUDE.md §4b). guard-trailer.test.sh measured and documented this first; this file
# read the pipeline's code until 2026-10-12 and carried an intermittent red because of
# it. The hook's own stdin contract is asserted separately, by `writer_rc` below.
hook() { # hook <json> — runs the hook, echoes WRAP, PASS or EXITn
  local out rc
  printf '%s' "$1" > "$TMP/payload.json"
  out="$(bash "$H" < "$TMP/payload.json" 2>/dev/null)"; rc=$?
  if [ "$rc" -ne 0 ]; then echo "EXIT$rc"; return; fi
  if [ -n "$out" ]; then echo WRAP; else echo PASS; fi
}

# writer_rc keeps the pipe ON PURPOSE, and reports the WRITER's fate rather than the
# hook's verdict. It is the only way to observe whether the hook drained stdin: a hook
# that exits first leaves the writer on a closed pipe, and the writer dies on SIGPIPE
# once the kernel can no longer absorb the payload. The harness is that writer in
# production.
# ⚠ IT REPEATS, BECAUSE A RACE WAS ONCE THE ONLY THING ON OFFER AND ONE TRIAL IS NOT A
# MEASUREMENT. Under a payload the kernel may absorb, the writer's fate turns on
# scheduling: against the pre-fix hook a 100 KB payload died 8 times out of 8 in a tight
# loop but survived 1 run in 3 inside this script, and the sizes tried next were no more
# certain (300 KB: 6 of 8; 1 MB: 6 of 8). Both sit at or under `fs.pipe-max-size`
# (1048576 here), which is the ceiling `cat` can splice past the 16-slot pipe, so each one
# was still absorbable and no number of trials makes it otherwise. The payload is now
# derived at four times that ceiling, which no setting absorbs. Five trials put a miss near
# 1 in 3000 when the race was real; they are kept as a tripwire. The leg
# stays honest about what it watches: the WRITER's fate, never the hook's verdict.
# The hatch goes on the call inline, like every other leg here. Checked before relying on
# it: bash does NOT keep `VAR=1 some_function` set after the function returns (POSIX
# permits that persistence, and it would silently hatch every leg below), so the inline
# form is safe in this file and no subshell is needed.
writer_rc() { # writer_rc <payload-file> <trials> — the worst exit code of the processes WRITING to the hook
  local i rc worst=0
  for ((i = 0; i < $2; i++)); do
    cat "$1" | bash "$H" >/dev/null 2>&1
    rc="${PIPESTATUS[0]}"
    [ "$rc" != 0 ] && worst="$rc"
  done
  printf '%s' "$worst"
}

payload() { jq -nc --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}'; }
# payloadf takes a FILE, not the text: past one argv slot (MAX_ARG_STRLEN, 128 KB on
# Linux) `jq --arg` dies with "Argument list too long" and leaves payload() empty — and a
# leg fed an empty payload passes without examining anything. Measured: it survives 70 KB
# and fails at 300 KB. --rawfile reads the file, so there is no argv to overflow and the
# helper is safe at any size.
payloadf() { jq -nc --rawfile c "$1" '{tool_name:"Bash",tool_input:{command:$c}}'; }
expect() { # expect <want> <label> <command>
  local got; got="$(hook "$(payload "$3")")"
  if [ "$got" = "$1" ]; then printf '  ok    %-56s %s\n' "$2" "$got"
  else printf '  FAIL  %-56s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}
expectj() { # expectj <want> <label> <json>
  local got; got="$(hook "$3")"
  if [ "$got" = "$1" ]; then printf '  ok    %-56s %s\n' "$2" "$got"
  else printf '  FAIL  %-56s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}

printf 'a\nb\na\n' > "$TMP/f"

echo "── the plain case ───────────────────────────────────────────────────────"
expect WRAP 'an unbounded command'                      'seq 1 500'
expect PASS 'an empty command'                          ''

echo "── bounded already · each PASS paired with a WRAP ───────────────────────"
expect PASS 'ends in head'                              'seq 1 500 | head -20'
expect PASS 'ends in tail'                              'seq 1 500 | tail -5'
expect PASS 'ends in wc'                                'seq 1 500 | wc -l'
expect WRAP '…but head in a MIDDLE stage is not the end' 'seq 1 500 | head -400 | sort'
expect PASS 'ends in grep -c'                           "grep -c a $TMP/f"
expect WRAP '…but grep with no -c counts nothing'       "grep -i a $TMP/f"
expect PASS 'ends in sort | uniq -c'                    "sort $TMP/f | uniq -c"
expect WRAP '…but uniq with no -c is unbounded'         "sort $TMP/f | uniq"

echo "── writes to a file ─────────────────────────────────────────────────────"
expect PASS 'redirects stdout to a file'                "seq 1 500 > $TMP/o"
expect PASS 'appends to a file'                         "seq 1 500 >> $TMP/o"
expect WRAP '…but 2>&1 is not a file write'             'seq 1 500 2>&1'
expect WRAP '…and &> alone is not a file write'         'seq 1 500 2>&1 | sort'

echo "── shapes the wrapper must not touch ────────────────────────────────────"
expect PASS 'a heredoc'                                 'cat <<EOF
x
EOF'
expect PASS 'a background command'                      'seq 1 500 &'
expect WRAP '…but && is not backgrounding'              'true && seq 1 500'
expect PASS 'contains a bare exit'                      'seq 1 500; exit 1'
expect PASS 'contains exec'                             'exec seq 1 500'
expect WRAP '…but the word "exited" is not exit'        'echo exited; seq 1 500'
# shellcheck disable=SC2016  # the literal must NOT expand: the hook matches the text
expect PASS 'is already wrapped'                        'x=$__trim_out; seq 1 500'

echo "── the hatch ────────────────────────────────────────────────────────────"
got="$(CLAUDE_ALLOW_UNTRIMMED=1 hook "$(payload 'seq 1 500')")"
if [ "$got" = PASS ]; then echo "  ok    CLAUDE_ALLOW_UNTRIMMED=1 in the environment       PASS"
else echo "  FAIL  the environment hatch did not release the hook: $got"; fail=$((fail+1)); fi

# ⚠ THE HOOK MUST DRAIN STDIN BEFORE IT EXITS, AND THE HATCH IS THE PATH THAT DID NOT.
# The hatch sat above the read, so it exited on a payload it had never consumed and left
# the writer — the harness, in production — holding a closed pipe. At ~70 bytes the write
# fits the 64 KB pipe buffer and completes, so the leg above passes either way; a payload past
# `fs.pipe-max-size` cannot be absorbed, so the writer blocks and takes SIGPIPE. Pre-fix this read
# 141 in 5 runs out of 5 at 70 KB; post-fix 0. The blob is never executed, only measured for size.
head -c "$_PROBE_BYTES" /dev/zero | tr '\0' x > "$TMP/big"
[ "$(wc -c < "$TMP/big")" = "$_PROBE_BYTES" ] || { echo "  FAIL  the derived payload was not built"; fail=$((fail+1)); }
payloadf "$TMP/big" > "$TMP/big.json"
got="$(CLAUDE_ALLOW_UNTRIMMED=1 writer_rc "$TMP/big.json" 5)"
if [ "$got" = 0 ]; then echo "  ok    the hatch drains a payload past pipe-max   rc=0"
else echo "  FAIL  the writer into the hatched hook exited $got (141 = SIGPIPE, the hook never read it)"; fail=$((fail+1)); fi
# The pair: the fix must not have moved the stall onto the path that does the work. One
# trial, not five — that path always reads to the end, so there is no race to repeat, and
# it is the expensive one (see the cost note below).
got="$(writer_rc "$TMP/big.json" 1)"
if [ "$got" = 0 ]; then echo "  ok    …and so does the rewriting path                  rc=0"
else echo "  FAIL  the writer into the rewriting hook exited $got"; fail=$((fail+1)); fi
# The same payload by redirect asks the other question: what the hook DECIDED.
got="$(CLAUDE_ALLOW_UNTRIMMED=1 hook "$(cat "$TMP/big.json")")"
if [ "$got" = PASS ]; then echo "  ok    …and the hatch still releases it                PASS"
else echo "  FAIL  the hatch over the derived payload: $got, want PASS"; fail=$((fail+1)); fi

# ⚠ A COMMAND TOO LONG FOR ONE ARGV SLOT PASSES THROUGH, QUIETLY AND ON PURPOSE. The final
# `jq --arg c "$wrapped"` cannot take a string over MAX_ARG_STRLEN (128 KB on Linux): jq
# died, the hook printed jq's error on stderr and emitted nothing — rc 0, so the command
# ran untrimmed, but with 75 bytes of noise and, before the cost fix, 25 s of rescanning
# first. The hook now declares a ceiling (TRIM_MAX_CMD) and passes a longer command through
# before doing any work. The three legs: just under the ceiling still REWRITES (so the
# ceiling is not "everything big passes"), just over and 300 KB give NOTHING on stdout AND
# NOTHING on stderr, exit 0. The text is `echo a | echo a | …| cat`: it holds pipes, so
# the quadratic `${cmd##*|}` the cost fix removed cannot make this leg slow on any hook.
max="$(sed -n 's/^TRIM_MAX_CMD=\([0-9][0-9]*\).*/\1/p' "$H")"
if [ -n "$max" ] && [ "$max" -lt 131072 ]; then printf '  ok    the hook declares TRIM_MAX_CMD=%s, under MAX_ARG_STRLEN\n' "$max"
else echo "  FAIL  the hook declares no TRIM_MAX_CMD under 131072 (got '${max}') — the legs below cannot be sized"; fail=$((fail+1)); max=126000; fi
long_cmd() { # long_cmd <bytes> <file> — a pipe-rich command of about that length, ending in `| cat`
  yes 'echo a | ' 2>/dev/null | tr -d '\n' | head -c "$1" > "$2"; printf 'cat' >> "$2"
}
long_leg() { # long_leg <bytes> <want WRAP|PASS> <label>
  local n="$1" want="$2" label="$3" rc out err
  long_cmd "$n" "$TMP/long"; payloadf "$TMP/long" > "$TMP/long.json"
  bash "$H" < "$TMP/long.json" > "$TMP/long.out" 2> "$TMP/long.err"; rc=$?
  out="$(wc -c < "$TMP/long.out")"; err="$(wc -c < "$TMP/long.err")"
  if [ "$want" = WRAP ] && [ "$rc" = 0 ] && [ "$out" -gt 0 ] && [ "$err" = 0 ]; then
    printf '  ok    %-56s WRAP\n' "$label"
  elif [ "$want" = PASS ] && [ "$rc" = 0 ] && [ "$out" = 0 ] && [ "$err" = 0 ]; then
    printf '  ok    %-56s PASS, stderr empty\n' "$label"
  else
    printf '  FAIL  %-56s rc=%s stdout=%s bytes stderr=%s bytes, want %s with both empty-handed\n' "$label" "$rc" "$out" "$err" "$want"; fail=$((fail+1))
  fi
}
long_leg $((max - 1000)) WRAP 'a command just under the ceiling is still rewritten'
long_leg $((max + 1000)) PASS '…and one just over it passes through, silently'
long_leg 300000          PASS '…and so does one of 300 KB (no jq error on stderr)'
# ⚠ THE REWRITING PATH IS LINEAR IN THE LENGTH OF THE COMMAND — measured, with the cause. The
# cost sat in ONE expansion, `last="${cmd##*|}"` (the last pipeline stage), which bash 5.2
# evaluates in quadratic time when the command holds no `|`, spaces or not. The sed and grep
# passes are cheap (measured: 5 ms each at 70 KB). So the leg feeds ONE 120 KB command, under 128 KB so
# the final `jq --arg` still fits, and gives the hook a hard budget with `timeout`. The
# budget is generous on purpose (fixed: milliseconds; before the fix: 5.8 s at 100 KB and
# 8+ s at 120 KB on a slow box, 1.6 s at 100 KB on rig-x870), so a loaded runner cannot
# turn it red but the quadratic cannot hide under it. It also asserts the hook still
# REWROTE the command, so a hook that merely gave up early cannot pass.
head -c 120000 /dev/zero | tr '\0' x > "$TMP/blob"
payloadf "$TMP/blob" > "$TMP/blob.json"
timeout 3 bash "$H" < "$TMP/blob.json" > "$TMP/blob.out" 2>/dev/null; rc=$?
if [ "$rc" = 124 ]; then echo "  FAIL  a 120 KB unbroken command took over 3 s — the rewriting path is superlinear"; fail=$((fail+1))
elif [ "$rc" = 0 ] && [ -s "$TMP/blob.out" ]; then echo "  ok    a 120 KB unbroken command is rewritten inside 3 s     rc=0"
else echo "  FAIL  the 120 KB unbroken command: rc=$rc, output $(wc -c < "$TMP/blob.out") bytes"; fail=$((fail+1)); fi

echo "── the other input fields ───────────────────────────────────────────────"
expectj PASS 'a background flag on the input'  "$(jq -nc '{tool_name:"Bash",tool_input:{command:"seq 1 500",run_in_background:true}}')"
expectj WRAP '…and the same input foregrounded' "$(jq -nc '{tool_name:"Bash",tool_input:{command:"seq 1 500",run_in_background:false}}')"
expectj PASS 'a non-Bash tool is never rewritten' "$(jq -nc '{tool_name:"Edit",tool_input:{command:"seq 1 500"}}')"

echo "── the emitted JSON ─────────────────────────────────────────────────────"
out="$(printf '%s' "$(jq -nc '{tool_name:"Bash",scratchpad_dir:"/nonexistent-xyz",tool_input:{command:"seq 1 500",description:"d",timeout:1234}}')" | bash "$H")"
k="$(printf '%s' "$out" | jq -r '.hookSpecificOutput|keys|join(",")')"
if [ "$k" = "hookEventName,updatedInput" ]; then echo "  ok    hookSpecificOutput holds ONLY hookEventName and updatedInput"
else echo "  FAIL  hookSpecificOutput keys are '$k'"; fail=$((fail+1)); fi
# The one field this hook must never send. permissionDecision:"allow" would approve the
# call with no prompt and would step past the owner's permission mode.
if printf '%s' "$out" | grep -q permissionDecision; then
  echo "  FAIL  the hook sent permissionDecision — that bypasses the permission mode"; fail=$((fail+1))
else echo "  ok    no permissionDecision in the output"; fi
if [ "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.hookEventName')" = PreToolUse ]; then
  echo "  ok    hookEventName is PreToolUse"
else echo "  FAIL  wrong hookEventName"; fail=$((fail+1)); fi
# updatedInput REPLACES the input object, so every other field must survive the copy.
for f in description timeout; do
  if [ "$(printf '%s' "$out" | jq -r ".hookSpecificOutput.updatedInput.$f // \"\"")" != "" ]; then
    printf '  ok    updatedInput keeps %-38s\n' "$f"
  else printf '  FAIL  updatedInput dropped %s\n' "$f"; fail=$((fail+1)); fi
done
# An absent scratchpad directory must not become the scratch path.
if printf '%s' "$out" | grep -q '/nonexistent-xyz'; then
  echo "  FAIL  used a scratchpad_dir that does not exist"; fail=$((fail+1))
else echo "  ok    an absent scratchpad_dir falls back to TMPDIR"; fi

echo "── run the rewritten command ────────────────────────────────────────────"
rewrite() { payload "$1" | bash "$H" | jq -r '.hookSpecificOutput.updatedInput.command'; }
o="$(eval "$(rewrite 'seq 1 500')")"; rc=$?
n="$(printf '%s\n' "$o" | wc -l)"
if [ "$n" = 101 ] && [ "$rc" = 0 ]; then echo "  ok    500 lines print as 101 (60 + 1 + 40), exit 0"
else echo "  FAIL  500 lines printed $n lines, exit $rc"; fail=$((fail+1)); fi
if printf '%s' "$o" | grep -qF '400 lines omitted, full output: '; then
  echo "  ok    the omitted count is 400, and the path is named"
else echo "  FAIL  the omitted-count line is wrong: $(printf '%s' "$o" | grep omitted)"; fail=$((fail+1)); fi
# The boundary. 200 lines must survive whole, 201 must not.
if [ "$(eval "$(rewrite 'seq 1 200')" | wc -l)" = 200 ]; then echo "  ok    200 lines print whole"
else echo "  FAIL  200 lines were trimmed"; fail=$((fail+1)); fi
if [ "$(eval "$(rewrite 'seq 1 201')" | wc -l)" = 101 ]; then echo "  ok    201 lines are trimmed"
else echo "  FAIL  201 lines were not trimmed"; fail=$((fail+1)); fi
# The exit code is the command's, never the wrapper's.
eval "$(rewrite 'seq 1 500; false')" >/dev/null 2>&1; rc=$?
if [ "$rc" = 1 ]; then echo "  ok    a failing command still exits 1"
else echo "  FAIL  the wrapper swallowed a non-zero exit code"; fail=$((fail+1)); fi
eval "$(rewrite 'seq 1 500 1>&2')" >/dev/null 2>&1; rc=$?
if [ "$rc" = 0 ]; then echo "  ok    stderr is captured too, exit unchanged"
else echo "  FAIL  a stderr-only command changed its exit code"; fail=$((fail+1)); fi
# `cd` must persist, which is why the command runs in a brace group and not a subshell.
if ( cd "$TMP" && eval "$(rewrite 'cd / ; seq 1 300')" >/dev/null 2>&1 && [ "$PWD" = / ] ); then
  echo "  ok    cd inside the wrapper persists"
else echo "  FAIL  the wrapper ran the command in a subshell"; fail=$((fail+1)); fi

echo "── structural ───────────────────────────────────────────────────────────"
# This hook is a rewriter, so it must NEVER deny. exit 2 is the deny code.
for c in 'seq 1 500' '' 'rm -rf /' 'git commit -m x'; do
  printf '%s' "$(payload "$c")" | bash "$H" >/dev/null 2>&1; rc=$?
  if [ "$rc" = 2 ]; then echo "  FAIL  the hook denied: $c"; fail=$((fail+1)); fi
done
echo "  ok    the hook never exits 2 — it rewrites or it passes through"
# The terminal `exit 0` is correct here, because the hook's last act is to emit the JSON.
# An UNCONDITIONAL `exit 0` above it would make every leg below it dead code, which is the
# defect guard-ruff.test.sh pins. The test is zero-indent only, and that is a heuristic:
# bash does not read indentation, so an indented `exit 0` inside an `if` block is the
# legitimate shape and this hook has four of them. The real detector of that defect is the
# first leg of this file — insert a bare `exit 0` anywhere above and `seq 1 500` reads PASS.
last="$(tail -n1 "$H")"
if [ "$last" = "exit 0" ]; then echo "  ok    the terminal statement is exit 0"
else echo "  FAIL  the last line is '$last'"; fail=$((fail+1)); fi
n=$(head -n -1 "$H" | grep -cE '^exit 0[[:space:]]*$')
if [ "$n" -eq 0 ]; then echo "  ok    no top-level early exit above it"
else echo "  FAIL  $n top-level 'exit 0' above the last line — dead code below"; fail=$((fail+1)); fi
# The three numbers live in the hook, and the legs above read 60, 40 and 200.
for want in 'TRIM_HEAD=60' 'TRIM_TAIL=40' 'TRIM_THRESHOLD=200'; do
  if grep -qF "$want" "$H"; then printf '  ok    the hook declares %-42s\n' "$want"
  else printf '  FAIL  the hook no longer declares %s — this test is now lying\n' "$want"; fail=$((fail+1)); fi
done
if grep -qF 'CLAUDE_ALLOW_UNTRIMMED=1' "$H"; then echo "  ok    the hatch is named in the hook"
else echo "  FAIL  the hatch is undocumented"; fail=$((fail+1)); fi

[ "$fail" -eq 0 ] && echo "  all trim-output checks passed" || echo "  $fail FAILED"
exit $((fail > 0))
