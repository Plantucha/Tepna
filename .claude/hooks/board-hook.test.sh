#!/usr/bin/env bash
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# board-hook.test.sh — the inbox push and the finish check, against a fake agent-board.
set -uo pipefail

# THE HOOK MUST NOT INHERIT THE RUNNING SESSION'S HATCH. `CLAUDE_ALLOW_NO_BOARD_POST=1` is documented in
# command position, and that is also the position which EXPORTS it to every child — `npm run
# check` is a child, so every DENY leg below would score ALLOW and the gate would report a
# disarmed instrument as broken legs. Measured 2026-10-21: 9 of the 11 hatch-reading
# self-tests moved from PASS to RED with their own hatch exported. Gated by
# the suite group `every hatch-reading hook has a self-test its own hatch cannot disarm`, whose
# population is `.claude/hooks/` itself. A leg that WANTS the hatch sets it inline, per leg,
# which an `unset` at the top of the file does not touch.
unset CLAUDE_ALLOW_NO_BOARD_POST
HOOK="$(cd "$(dirname "$0")" && pwd)/board-hook.sh"
# ⚠ THE WRITER-FATE PAYLOAD IS SIZED FROM THE KERNEL, NOT FROM A ROUND NUMBER. `--probe-bytes`
# returns four times this box's `fs.pipe-max-size` with a 4 MiB floor, and nothing past that
# ceiling can be absorbed into a pipe. guard-trailer.test.sh carries the measurement behind the
# formula. A size that cannot be derived refuses (exit 2): a leg that would examine nothing.
_PROBE_TOOL="$(cd "$(dirname "$0")/../.." && pwd)/tools/hook-contract.mjs"
_PROBE_BYTES="$(node "$_PROBE_TOOL" --probe-bytes 2>/dev/null)"
case "$_PROBE_BYTES" in ''|*[!0-9]*) printf '  REFUSE  the writer-fate payload size could not be derived (%s --probe-bytes)\n' "$_PROBE_TOOL" >&2; exit 2 ;; esac
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
check() { # name want got
  if [ "$2" = "$3" ]; then pass=$((pass + 1)); echo "  ok    $1"
  else fail=$((fail + 1)); echo "  FAIL  $1"; echo "        want: $2"; echo "        got:  $3"; fi
}

# The fake board records its arguments and prints a hook reply for `hook`.
cat > "$T/board" <<'FAKE'
#!/usr/bin/env bash
cat >/dev/null
echo "$*" >> "$AGENT_BOARD_DIR/calls"
case " $* " in *" hook "*) echo '{"hookSpecificOutput":{"additionalContext":"board item"}}' ;; esac
FAKE
chmod +x "$T/board"
export AGENT_BOARD_BIN="$T/board" AGENT_BOARD_DIR="$T/dir" HERDR_ENV=0
mkdir -p "$T/dir"

bash_use() { printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"%s"}}]}}\n' "$1"; }
# A command that spans lines cannot go through printf: jq quotes it.
bash_use_raw() { jq -c --arg c "$1" -n '{type:"assistant",message:{content:[{type:"tool_use",name:"Bash",input:{command:$c}}]}}'; }
stop() { printf '{"hook_event_name":"Stop","stop_hook_active":%s,"transcript_path":"%s"}' "$1" "$2"; }

echo "### NO FLEET NAME, NO WIRING"
got="$(printf '{"hook_event_name":"UserPromptSubmit"}' | AGENT_BOARD_NAME='' bash "$HOOK" inbox; echo "rc=$?")"
check "no name: silent, exit 0" "rc=0" "$got"
got="$(printf '{}' | AGENT_BOARD_NAME=muse bash "$HOOK" inbox; echo "rc=$?")"
check "a name outside the fleet: silent" "rc=0" "$got"

echo "### INBOX"
export AGENT_BOARD_NAME=Magpie
got="$(printf '{"hook_event_name":"UserPromptSubmit"}' | bash "$HOOK" inbox)"
check "UserPromptSubmit passes the board reply through" '{"hookSpecificOutput":{"additionalContext":"board item"}}' "$got"
check "the first run subscribes the bird to thread 1" "1" "$(grep -c -- '--as magpie subscribe 1$' "$T/dir/calls")"
check "…and to tag:fleet" "1" "$(grep -c -- '--as magpie subscribe tag:fleet$' "$T/dir/calls")"
check "every turn: interval 0" "1" "$(grep -c -- '--as magpie hook --interval 0$' "$T/dir/calls")"
printf '{"hook_event_name":"PostToolUse"}' | bash "$HOOK" inbox >/dev/null
check "tool use: interval 300" "1" "$(grep -c -- 'hook --interval 300$' "$T/dir/calls")"
check "the second run does not subscribe again" "1" "$(grep -c -- 'subscribe 1$' "$T/dir/calls")"

echo "### FINISH"
tr="$T/t.jsonl"
{ bash_use "$HOME/.local/bin/agent-board --as magpie post 1 - --kind note < a.md"; bash_use "gh pr create --base main"; } > "$tr"
got="$(stop false "$tr" | bash "$HOOK" finish | jq -r .decision)"
check "a PR opened after the last post: block" "block" "$got"
got="$(stop false "$tr" | bash "$HOOK" finish | jq -r .reason | grep -c 'gh pr create')"
check "…and the reason names the command" "1" "$got"
got="$(stop true "$tr" | bash "$HOOK" finish)"
check "stop_hook_active: let the second stop through" "" "$got"
got="$(stop false "$tr" | CLAUDE_ALLOW_NO_BOARD_POST=1 bash "$HOOK" finish)"
check "the hatch lets it through" "" "$got"
bash_use "agent-board --as magpie post 1 - --kind note < b.md" >> "$tr"
got="$(stop false "$tr" | bash "$HOOK" finish)"
check "a post after the PR: no block" "" "$got"
bash_use "node tools/wt-done.mjs ../wt-x" >> "$tr"
got="$(stop false "$tr" | bash "$HOOK" finish | jq -r .decision)"
check "wt-done after the last post: block" "block" "$got"
bash_use "git push origin x" > "$T/p.jsonl"
got="$(stop false "$T/p.jsonl" | bash "$HOOK" finish)"
check "a plain push is not a finish" "" "$got"
got="$(stop false "$T/missing.jsonl" | bash "$HOOK" finish; echo "rc=$?")"
check "an unreadable transcript fails open" "rc=0" "$got"
got="$(stop false "$tr" | AGENT_BOARD_BIN="$T/none" bash "$HOOK" finish; echo "rc=$?")"
check "no agent-board installed fails open" "rc=0" "$got"

echo "### A HEREDOC BODY IS DATA, NOT A COMMAND"
# The detector reads the command TEXT, so a note that QUOTES a finishing path used to count as
# running it: the hook asked for a note twice on 2026-10-20, after board #654 and #679 were
# already posted. Both directions are staged, because a quoted post would silence an owed note.
hd="$T/hd.jsonl"
bash_use "$HOME/.local/bin/agent-board --as magpie post 1 - --kind note < a.md" > "$hd"
bash_use_raw "$(printf 'cat > note.md <<%sEOF%s\nI retired the tree with node tools/wt-done.mjs ../wt-x\nEOF' "'" "'")" >> "$hd"
got="$(stop false "$hd" | bash "$HOOK" finish)"
check "a retirement path quoted in a heredoc is not a retirement" "" "$got"
bash_use "node tools/wt-done.mjs ../wt-x" >> "$hd"
got="$(stop false "$hd" | bash "$HOOK" finish | jq -r .decision)"
check "…and the real command on its own line still blocks" "block" "$got"
hp="$T/hp.jsonl"
# The quoted post comes AFTER the real finish on purpose: order alone would block either way,
# so only this arrangement can tell a stripped body from an unstripped one.
bash_use "gh pr ready 3783" > "$hp"
bash_use_raw "$(printf 'cat > note.md <<%sEOF%s\nposted with agent-board --as magpie post 1 - --kind note\nEOF' "'" "'")" >> "$hp"
got="$(stop false "$hp" | bash "$HOOK" finish | jq -r .decision)"
check "a post line quoted in a heredoc is not a post" "block" "$got"

echo "### THE WRITER'S FATE AT EVERY EXIT ABOVE THE WORK"
# ⚠ EVERY LEG ABOVE READS THE HOOK'S VERDICT, SO NONE OF THEM CAN SEE THIS. The harness writes
# the hook JSON down a pipe; an exit taken before `cat` strands that writer on a closed pipe and
# costs it SIGPIPE, while the verdict it printed still looks right. This leg reads the WRITER's
# own code through `PIPESTATUS[0]` instead. The pipe stays ON PURPOSE (a redirect has no writer
# to lose), the payload is sized past `fs.pipe-max-size`, and it repeats because the defect is a
# race. Three exits are staged, because board-hook's earliest is not a hatch: an absent board
# binary, then the hatch, then `stop_hook_active`. Same contract trim-output.test.sh pins (#3493).
head -c "$_PROBE_BYTES" /dev/zero | tr '\0' x > "$T/pad"
writer_fate() { # json-file [env=value …] → the worst writer exit over five trials
  local f="$1"; shift
  local _worst=0 _rc _i
  for _i in 1 2 3 4 5; do
    cat "$f" | env "$@" bash "$HOOK" finish >/dev/null 2>&1
    _rc="${PIPESTATUS[0]}"; [ "$_rc" != 0 ] && _worst="$_rc"
  done
  printf '%s' "$_worst"
}
jq -nc --rawfile p "$T/pad" --arg tr "$tr" '{hook_event_name:"Stop",stop_hook_active:false,transcript_path:$tr,pad:$p}' > "$T/stop-big.json"
jq -nc --rawfile p "$T/pad" --arg tr "$tr" '{hook_event_name:"Stop",stop_hook_active:true,transcript_path:$tr,pad:$p}' > "$T/stop-big-active.json"
check "the writer survives an absent board binary" "0" "$(writer_fate "$T/stop-big.json" AGENT_BOARD_BIN="$T/none")"
check "…the hatch" "0" "$(writer_fate "$T/stop-big.json" CLAUDE_ALLOW_NO_BOARD_POST=1)"
check "…and stop_hook_active" "0" "$(writer_fate "$T/stop-big-active.json" BOARD_HOOK_UNUSED=1)"

echo "board-hook: $pass passing, $fail failing"
[ "$fail" -eq 0 ]
