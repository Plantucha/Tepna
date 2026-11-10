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
unset CLAUDE_ALLOW_UNACKED
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
# The ack check loads the board MODULE. Every leg above the ack block reads no module, so no
# leg can owe an ack by accident; the ack legs point AGENT_BOARD_PY at a fake module.
export AGENT_BOARD_PY="$T/no-module.py"
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
bash_use "gh pr create --base main && node tools/board-note.mjs --as magpie n.md" > "$T/c.jsonl"
got="$(stop false "$T/c.jsonl" | bash "$HOOK" finish)"
check "a board-note chained onto the finish in one call: no block" "" "$got"
{ bash_use "node tools/board-note.mjs --as magpie n.md"; bash_use "gh pr ready 1"; } > "$T/c2.jsonl"
got="$(stop false "$T/c2.jsonl" | bash "$HOOK" finish | jq -r .decision)"
check "a board-note BEFORE a later finish still owes the post" "block" "$got"
bash_use "git push origin x" > "$T/p.jsonl"
got="$(stop false "$T/p.jsonl" | bash "$HOOK" finish)"
check "a plain push is not a finish" "" "$got"
got="$(stop false "$T/missing.jsonl" | bash "$HOOK" finish; echo "rc=$?")"
check "an unreadable transcript fails open" "rc=0" "$got"
got="$(stop false "$tr" | AGENT_BOARD_BIN="$T/none" bash "$HOOK" finish; echo "rc=$?")"
check "no agent-board installed fails open" "rc=0" "$got"

echo "### ACK OWED"
# A fake board module. It returns its open acks only when the caller asks for 3650 days or more,
# so a hook that kept the board's 7-day default would read an empty list and the block leg reds.
cat > "$T/fakeboard.py" <<'FAKEPY'
import contextlib, json, os
class Board:
    def __init__(self, read_only=False):
        assert read_only
    def open_acks(self, max_age_days=7):
        return json.load(open(os.environ["FAKE_ACKS"])) if max_age_days >= 3650 else []
    @contextlib.contextmanager
    def reading(self):
        yield None
    def _identity(self, conn, agent, jobdir="", groups=None):
        return {agent}, set(os.environ.get("FAKE_GROUPS", "").split())
FAKEPY
printf '[{"id":77,"thread_id":8,"author":"heron","body":"@magpie take the slot","ack":{"missing":["magpie"]}}]' > "$T/a-me.json"
printf '[{"id":78,"thread_id":8,"author":"heron","body":"@all read this","ack":{"missing":["all"]}}]' > "$T/a-all.json"
printf '[{"id":79,"thread_id":8,"author":"heron","body":"@wren only","ack":{"missing":["wren"]}}]' > "$T/a-other.json"
printf '[{"id":80,"thread_id":8,"author":"magpie","body":"@all mine","ack":{"missing":["all"]}}]' > "$T/a-own.json"
: > "$T/empty.jsonl"
ackrun() { stop "$1" "$T/empty.jsonl" | AGENT_BOARD_PY="$T/fakeboard.py" FAKE_ACKS="$2" FAKE_GROUPS="${3:-}" ${4:+env "$4"} bash "$HOOK" finish; }
check "an ack addressed to this bird: block" "block" "$(ackrun false "$T/a-me.json" | jq -r .decision)"
check "…the reason names the entry" "1" "$(ackrun false "$T/a-me.json" | jq -r .reason | grep -c '#77 by heron in thread 8')"
check "…and the ack command" "1" "$(ackrun false "$T/a-me.json" | jq -r .reason | grep -c 'agent-board --as magpie ack <id>')"
check "an ack addressed to a group this bird is in: block" "block" "$(ackrun false "$T/a-all.json" all | jq -r .decision)"
check "the same group, bird not a member: no block" "" "$(ackrun false "$T/a-all.json")"
check "an ack owed by another bird: no block" "" "$(ackrun false "$T/a-other.json" all)"
check "a decision this bird wrote: no block" "" "$(ackrun false "$T/a-own.json" all)"
check "stop_hook_active: let the second stop through" "" "$(ackrun true "$T/a-me.json")"
check "the hatch lets it through" "" "$(ackrun false "$T/a-me.json" "" CLAUDE_ALLOW_UNACKED=1)"
check "a module that will not load fails open" "rc=0" "$(stop false "$T/empty.jsonl" | AGENT_BOARD_PY="$T/board" bash "$HOOK" finish; echo "rc=$?")"
{ bash_use "gh pr create --base main"; } > "$T/both.jsonl"
got="$(stop false "$T/both.jsonl" | AGENT_BOARD_PY="$T/fakeboard.py" FAKE_ACKS="$T/a-me.json" bash "$HOOK" finish | jq -r .reason)"
check "a post and an ack both owed: one block names both" "2" "$(printf '%s' "$got" | grep -cE '^(Board post owed|Ack owed)')"
echo "### ONE GARBLED ENTRY MUST NOT DISARM THE GATE"
# Three shapes, measured against the pre-fix hook. It RAISED on an entry with no `ack` key and
# on an entry that is not an object, and it dropped the valid ack beside them. A `missing` field
# that is a string never raised: `set("magpie")` is a set of characters, so that entry matched
# nothing and said nothing. It reads as unreadable now, and the count is reported.
printf '[{"id":81,"thread_id":8,"author":"heron","body":"@magpie no ack key"}]' > "$T/a-garbled.json"
printf '[{"id":81,"thread_id":8,"author":"heron","body":"@magpie no ack key"},{"id":77,"thread_id":8,"author":"heron","body":"@magpie take the slot","ack":{"missing":["magpie"]}}]' > "$T/a-mixed.json"
printf '[{"id":82,"thread_id":8,"author":"heron","body":"@magpie string","ack":{"missing":"magpie"}},{"id":77,"thread_id":8,"author":"heron","body":"@magpie take the slot","ack":{"missing":["magpie"]}}]' > "$T/a-str.json"
printf '["oops",{"id":77,"thread_id":8,"author":"heron","body":"@magpie take the slot","ack":{"missing":["magpie"]}}]' > "$T/a-notdict.json"
check "a garbled entry beside a valid owed ack: still blocks" "block" "$(ackrun false "$T/a-mixed.json" | jq -r .decision)"
check "…and the reason names the valid entry" "1" "$(ackrun false "$T/a-mixed.json" | jq -r .reason | grep -c '#77 by heron in thread 8')"
check "…and it reports the entry it could not read" "1" "$(ackrun false "$T/a-mixed.json" | jq -r .reason | grep -c '1 further open entry/entries carry no readable ack field')"
check "a missing field that is a string: the valid ack beside it still blocks" "block" "$(ackrun false "$T/a-str.json" | jq -r .decision)"
check "an entry that is not an object at all: still blocks" "block" "$(ackrun false "$T/a-notdict.json" | jq -r .decision)"
check "a garbled entry alone owes nothing: no block" "" "$(ackrun false "$T/a-garbled.json")"
check "…and it exits 0" "rc=0" "$(ackrun false "$T/a-garbled.json"; echo "rc=$?")"

check "the post hatch leaves the ack check armed" "block" "$(ackrun false "$T/a-me.json" "" CLAUDE_ALLOW_NO_BOARD_POST=1 | jq -r .decision)"

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
