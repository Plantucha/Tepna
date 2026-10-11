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
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/trim-output.sh"
fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

hook() { # hook <json> — runs the hook, echoes WRAP, PASS or EXITn
  local out rc
  out="$(printf '%s' "$1" | bash "$H" 2>/dev/null)"; rc=$?
  if [ "$rc" -ne 0 ]; then echo "EXIT$rc"; return; fi
  if [ -n "$out" ]; then echo WRAP; else echo PASS; fi
}
payload() { jq -nc --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}'; }
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
expect PASS 'the hatch inline, anchored'                'CLAUDE_ALLOW_UNTRIMMED=1 seq 1 500'
expect WRAP '…but naming it in prose must NOT release' 'echo "set CLAUDE_ALLOW_UNTRIMMED=1 to skip"; seq 1 500'

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
