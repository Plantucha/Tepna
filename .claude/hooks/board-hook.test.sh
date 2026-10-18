#!/usr/bin/env bash
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# board-hook.test.sh — the inbox push and the finish check, against a fake agent-board.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")" && pwd)/board-hook.sh"
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

echo "board-hook: $pass passing, $fail failing"
[ "$fail" -eq 0 ]
