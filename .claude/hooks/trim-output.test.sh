#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# trim-output.test.sh — self-test for trim-output.sh.
#
# It drives the hook exactly as the harness does: the PostToolUse JSON on stdin, with the
# tool's own result in `tool_response`. Every TRIM is paired with a PASS that differs in
# ONE property, so a rule that fires on everything scores as loudly as a rule that fires
# on nothing. That is the discipline guard-format.test.sh established.
#
# It also reads the replaced output back. A hook whose counting line is wrong, or whose
# file does not hold the whole output, would lose the middle of every long result.
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
# The shared needle readers. A leg whose PASS is an ABSENCE needs a reader that cannot fail to
# look, and `grep` through a pipe reads "could not look" as "not there" — row
# 2026-11-09-four-selftest-legs-print-ok-when-their-reader-fails-to-look.
_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/tools/hook-test-lib.sh"
if [ ! -r "$_LIB" ]; then printf '  REFUSE  the needle readers are unreadable at %s\n' "$_LIB" >&2; exit 2; fi
# The path is a runtime expression, so shellcheck resolves it only under -x, which no gate runs.
# shellcheck source=../../tools/hook-test-lib.sh disable=SC1091
. "$_LIB"
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
hook() { # hook <json> — runs the hook, echoes TRIM, PASS or EXITn
  local out rc
  printf '%s' "$1" > "$TMP/payload.json"
  out="$(bash "$H" < "$TMP/payload.json" 2>/dev/null)"; rc=$?
  if [ "$rc" -ne 0 ]; then echo "EXIT$rc"; return; fi
  if [ -n "$out" ]; then echo TRIM; else echo PASS; fi
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

# response <command> <stdout> [extra jq over the whole payload] — the text travels in a FILE:
# past one argv slot (MAX_ARG_STRLEN, 128 KB) `jq --arg` dies and leaves an empty payload,
# and a leg fed an empty payload passes without examining anything.
response() {
  printf '%s' "$2" > "$TMP/stdout.txt"
  jq -nc --arg c "$1" --rawfile o "$TMP/stdout.txt" --arg d "$TMP" \
    '{session_id:"s",hook_event_name:"PostToolUse",scratchpad_dir:$d,tool_name:"Bash",tool_input:{command:$c,description:"d"},tool_response:{stdout:$o,stderr:"",interrupted:false,isImage:false,noOutputExpected:false}} | '"${3:-.}"
}
expect() { # expect <want> <label> <json>
  local got; got="$(hook "$3")"
  if [ "$got" = "$1" ]; then printf '  ok    %-56s %s\n' "$2" "$got"
  else printf '  FAIL  %-56s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}
L500="$(seq 1 500)"; L200="$(seq 1 200)"; L201="$(seq 1 201)"
NL=$'\n'

echo "── the size test · each TRIM paired with a PASS ─────────────────────────"
expect TRIM 'an output of 500 lines'                    "$(response 'seq 1 500' "$L500")"
expect PASS 'an empty output'                           "$(response 'true' '')"
expect PASS '200 lines stay whole'                      "$(response 'seq 1 200' "$L200")"
expect PASS '…and 200 lines with a last newline too'    "$(response 'seq 1 200' "$L200$NL")"
expect TRIM '…but 201 lines are trimmed'                "$(response 'seq 1 201' "$L201")"
expect TRIM 'a long stderr counts as well'              "$(response 'x' 'a' '.tool_response.stderr = ([range(300)|tostring]|join("\n"))')"
expect PASS '…and a short one does not'                 "$(response 'x' 'a' '.tool_response.stderr = "one"')"

echo "── results this hook must not touch ─────────────────────────────────────"
expect PASS 'a tool that is not Bash'                   "$(response 'x' "$L500" '.tool_name = "Read"')"
expect PASS 'an image'                                  "$(response 'x' "$L500" '.tool_response.isImage = true')"
expect PASS 'a result the harness already put in a file' "$(response 'x' "$L500" '.tool_response.persistedOutputPath = "/x"')"
expect PASS 'a background task'                         "$(response 'x' "$L500" '.tool_response.backgroundTaskId = "b1"')"
expect PASS 'a background flag on the input'            "$(response 'x' "$L500" '.tool_input.run_in_background = true')"
expect TRIM '…and the same input in the foreground'     "$(response 'x' "$L500" '.tool_input.run_in_background = false')"
expect PASS 'a tool_response that is text'              "$(response 'x' "$L500" '.tool_response = .tool_response.stdout')"
expect PASS 'no tool_response (a PreToolUse payload)'   "$(response 'x' "$L500" 'del(.tool_response)')"
expect PASS 'a payload that is not JSON'                'not json'

echo "── the hatch ────────────────────────────────────────────────────────────"
got="$(CLAUDE_ALLOW_UNTRIMMED=1 hook "$(response 'seq 1 500' "$L500")")"
if [ "$got" = PASS ]; then echo "  ok    CLAUDE_ALLOW_UNTRIMMED=1 in the environment       PASS"
else echo "  FAIL  the environment hatch did not release the hook: $got"; fail=$((fail+1)); fi
expect PASS 'the inline hatch in command position'      "$(response 'CLAUDE_ALLOW_UNTRIMMED=1 seq 1 500' "$L500")"
expect PASS 'the hatch STACKED behind another'          "$(response 'CLAUDE_ALLOW_BLANKET_GIT=1 CLAUDE_ALLOW_UNTRIMMED=1 seq 1 500' "$L500")"
expect TRIM 'the hatch merely NAMED is data'            "$(response 'echo CLAUDE_ALLOW_UNTRIMMED=1; seq 1 500' "$L500")"

# ⚠ THE HOOK MUST DRAIN STDIN BEFORE IT EXITS, AND THE HATCH IS THE EARLIEST EXIT. A payload past
# `fs.pipe-max-size` cannot be absorbed, so a hook that exits unread leaves the writer on SIGPIPE.
# The blob is ONE line, so the working path reads it all and then has nothing to trim.
head -c "$_PROBE_BYTES" /dev/zero | tr '\0' x > "$TMP/big"
[ "$(wc -c < "$TMP/big")" = "$_PROBE_BYTES" ] || { echo "  FAIL  the derived payload was not built"; fail=$((fail+1)); }
jq -nc --rawfile o "$TMP/big" '{tool_name:"Bash",tool_input:{command:"x"},tool_response:{stdout:$o,stderr:"",isImage:false}}' > "$TMP/big.json"
got="$(CLAUDE_ALLOW_UNTRIMMED=1 writer_rc "$TMP/big.json" 5)"
if [ "$got" = 0 ]; then echo "  ok    the hatch drains a payload past pipe-max   rc=0"
else echo "  FAIL  the writer into the hatched hook exited $got (141 = SIGPIPE, the hook never read it)"; fail=$((fail+1)); fi
got="$(writer_rc "$TMP/big.json" 1)"
if [ "$got" = 0 ]; then echo "  ok    …and so does the working path                    rc=0"
else echo "  FAIL  the writer into the working hook exited $got"; fail=$((fail+1)); fi
# A result over one argv slot (128 KB) still trims, quietly and inside a budget: the payload
# travels on stdin alone. The budget is generous, so a loaded runner cannot turn it red.
seq 1 100000 > "$TMP/wide"
jq -nc --rawfile o "$TMP/wide" '{tool_name:"Bash",tool_input:{command:"x"},tool_response:{stdout:$o,stderr:"",isImage:false}}' > "$TMP/wide.json"
TMPDIR="$TMP" timeout 20 bash "$H" < "$TMP/wide.json" > "$TMP/wide.out" 2> "$TMP/wide.err"; rc=$?
n="$(jq -r '.hookSpecificOutput.updatedToolOutput.stdout | split("\n") | length' "$TMP/wide.out" 2>/dev/null)"
if [ "$rc" = 0 ] && [ "$n" = 101 ] && [ ! -s "$TMP/wide.err" ]; then echo "  ok    589 KB of output trims to 101 lines, stderr empty"
else echo "  FAIL  the wide output: rc=$rc lines=$n stderr=$(wc -c < "$TMP/wide.err") bytes"; fail=$((fail+1)); fi

echo "── the emitted JSON ─────────────────────────────────────────────────────"
response 'seq 1 500' "$L500" '.tool_response.gitOperation = {a:1}' > "$TMP/payload.json"
out="$(bash "$H" < "$TMP/payload.json")"
if says updatedToolOutput "$out"; then echo "  ok    the emitted JSON is the text the absence legs read"
else echo "  FAIL  UNEXAMINED: the emitted JSON holds no updatedToolOutput, so an absence below is not evidence"; fail=$((fail+1)); fi
k="$(printf '%s' "$out" | jq -r '.hookSpecificOutput|keys|join(",")')"
if [ "$k" = "hookEventName,updatedToolOutput" ]; then echo "  ok    hookSpecificOutput holds ONLY hookEventName and updatedToolOutput"
else echo "  FAIL  hookSpecificOutput keys are '$k'"; fail=$((fail+1)); fi
for no in permissionDecision updatedInput '"decision"'; do
  if says "$no" "$out"; then echo "  FAIL  the hook sent $no"; fail=$((fail+1))
  else echo "  ok    no $no in the output"; fi
done
if [ "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.hookEventName')" = PostToolUse ]; then echo "  ok    hookEventName is PostToolUse"
else echo "  FAIL  wrong hookEventName"; fail=$((fail+1)); fi
# The harness ignores a result of another shape, so every field but the text must come back equal.
want="$(jq -S 'del(.tool_response.stdout)|.tool_response' "$TMP/payload.json")"
have="$(printf '%s' "$out" | jq -S '.hookSpecificOutput.updatedToolOutput|del(.stdout)')"
if [ "$want" = "$have" ]; then echo "  ok    every other field of the result survives"
else echo "  FAIL  the result shape moved: $have"; fail=$((fail+1)); fi

echo "── the replaced text ────────────────────────────────────────────────────"
txt="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedToolOutput.stdout')"
n="$(printf '%s\n' "$txt" | wc -l)"
if [ "$n" = 101 ]; then echo "  ok    500 lines print as 101 (60 + 1 + 40)"
else echo "  FAIL  500 lines printed $n lines"; fail=$((fail+1)); fi
if [ "$(sed -n 60p <<<"$txt")" = 60 ] && [ "$(sed -n 62p <<<"$txt")" = 461 ] && [ "$(tail -n1 <<<"$txt")" = 500 ]; then
  echo "  ok    the head ends at 60 and the tail is 461 to 500"
else echo "  FAIL  the kept lines are wrong: $(sed -n '60p;62p' <<<"$txt")"; fail=$((fail+1)); fi
f="$(sed -n '61s/^… 400 lines omitted, full output: //p' <<<"$txt")"
if [ -n "$f" ] && [ "$(cat "$f" 2>/dev/null)" = "$L500" ]; then echo "  ok    the counting line says 400 and its file holds all 500 lines"
else echo "  FAIL  the file '$f' does not hold the whole output"; fail=$((fail+1)); fi
case "$f" in "$TMP"/trim-*.log) echo "  ok    the file is in the session scratchpad" ;;
  *) echo "  FAIL  the file is not in the scratchpad: $f"; fail=$((fail+1)) ;; esac
# stderr is trimmed by its own count and joins the same file.
response x "$L500" '.tool_response.stderr = ([range(300)|"e\(.)"]|join("\n"))' > "$TMP/payload.json"
out="$(bash "$H" < "$TMP/payload.json")"
n="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedToolOutput.stderr | split("\n") | length')"
f="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedToolOutput.stderr' | sed -n 's/^… 200 lines omitted, full output: //p')"
if [ "$n" = 101 ] && grep -qx 'e150' "$f" && grep -qx '250' "$f"; then echo "  ok    a long stderr trims too, and the file holds both streams"
else echo "  FAIL  stderr: $n lines, file '$f'"; fail=$((fail+1)); fi
# An absent scratchpad falls back to TMPDIR; no writable place means the output stays whole.
response x "$L500" '.scratchpad_dir = "/nonexistent-xyz"' > "$TMP/payload.json"
mkdir -p "$TMP/alt"; out="$(TMPDIR="$TMP/alt" bash "$H" < "$TMP/payload.json")"
if says "full output: $TMP/alt/trim-" "$out"; then echo "  ok    an absent scratchpad_dir falls back to TMPDIR"
else echo "  FAIL  the fallback directory was not used"; fail=$((fail+1)); fi
out="$(TMPDIR=/nonexistent-xyz bash "$H" < "$TMP/payload.json")"; rc=$?
if [ "$rc" = 0 ] && [ -z "$out" ]; then echo "  ok    no writable scratch means no trim, exit 0"
else echo "  FAIL  with no scratch: rc=$rc, $(wc -c <<<"$out") bytes"; fail=$((fail+1)); fi

echo "── structural ───────────────────────────────────────────────────────────"
# exit 2 from a PostToolUse hook reports an error to the session. This hook never does that.
bad=0
for j in "$(response 'seq 1 500' "$L500")" "$(response '' '')" 'not json' '' '{}'; do
  printf '%s' "$j" > "$TMP/payload.json"
  bash "$H" < "$TMP/payload.json" >/dev/null 2>&1; rc=$?
  if [ "$rc" != 0 ]; then echo "  FAIL  the hook exited $rc"; fail=$((fail+1)); bad=1; fi
done
[ "$bad" = 0 ] && echo "  ok    the hook always exits 0"
# An UNCONDITIONAL `exit 0` above the last line would make every leg below it dead code.
last="$(tail -n1 "$H")"
if [ "$last" = "exit 0" ]; then echo "  ok    the terminal statement is exit 0"
else echo "  FAIL  the last line is '$last'"; fail=$((fail+1)); fi
n=$(head -n -1 "$H" | grep -cE '^exit 0[[:space:]]*$')
if [ "$n" -eq 0 ]; then echo "  ok    no top-level early exit above it"
else echo "  FAIL  $n top-level 'exit 0' above the last line — dead code below"; fail=$((fail+1)); fi
for want in 'TRIM_HEAD=60' 'TRIM_TAIL=40' 'TRIM_THRESHOLD=200'; do
  if grep -qF "$want" "$H"; then printf '  ok    the hook declares %-42s\n' "$want"
  else printf '  FAIL  the hook no longer declares %s — this test is now lying\n' "$want"; fail=$((fail+1)); fi
done
if grep -qF 'CLAUDE_ALLOW_UNTRIMMED=1' "$H"; then echo "  ok    the hatch is named in the hook"
else echo "  FAIL  the hatch is undocumented"; fail=$((fail+1)); fi
# The wiring is the half a hook test usually cannot see: on PreToolUse this hook reads a payload
# with no result and does nothing, silently.
SET="$(dirname "$H")/../settings.json"
pre="$(jq '[.hooks.PreToolUse[].hooks[].command|select(contains("trim-output"))]|length' "$SET")"
post="$(jq '[.hooks.PostToolUse[]|select(.matcher=="Bash").hooks[].command|select(contains("trim-output"))]|length' "$SET")"
if [ "$pre/$post" = 0/1 ]; then echo "  ok    settings.json wires it on PostToolUse(Bash) alone"
else echo "  FAIL  settings.json wires it PreToolUse=$pre PostToolUse=$post"; fail=$((fail+1)); fi

[ "$fail" -eq 0 ] && echo "  all trim-output checks passed" || echo "  $fail FAILED"
exit $((fail > 0))
