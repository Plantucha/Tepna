#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# board-hook.sh — wires every fleet session to the Agent Message Board, so the inbox
# habit and the finish post do not depend on a session remembering them (owner,
# 2026-10-18: "wire it up to something so it bites and its not just dependent on memory").
#
#   board-hook.sh inbox   UserPromptSubmit + PostToolUse. Runs `agent-board hook`, which
#                         injects every NEW entry addressed to this bird, or on a thread or
#                         tag it subscribes to, as additionalContext. UserPromptSubmit runs
#                         with no throttle (every turn); PostToolUse runs at most once per
#                         BOARD_HOOK_INTERVAL seconds (default 300), so a long autonomous turn
#                         still hears the board.
#   board-hook.sh finish  Stop. Blocks the stop ONCE when this session ran a finishing
#                         command (`gh pr create`, `gh pr ready`, `tools/wt-done.mjs`) after its
#                         last board post, and names the post to write. `stop_hook_active`
#                         lets the second stop through, so it can never loop.
#
# THE NAME. A board identity is the bird's name (`--as kestrel`); the CLI's own guess is
# `claude:<job>`, which nobody addresses. Resolution: $AGENT_BOARD_NAME, else the herdr
# agent name of $HERDR_PANE_ID, accepted only when it is one of the six fleet names. No
# name → exit 0: a session outside the fleet (Muse, a scratch pane) is not wired.
#
# FAILS OPEN. No agent-board, no herdr, an unreadable transcript, any error: exit 0. A
# board outage must never stop a session from working.
#
# Hatch: CLAUDE_ALLOW_NO_BOARD_POST=1 lets a stop through without the finish post.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# Drain stdin before any exit (the harness writes the hook JSON there; see guard-trailer.sh).
payload="$(cat 2>/dev/null)" || exit 0
mode="${1:-}"

BOARD="${AGENT_BOARD_BIN:-$HOME/.local/bin/agent-board}"
[ -x "$BOARD" ] || exit 0

FLEET=" kestrel heron osprey magpie finch wren "

resolve_name() {
  local n="${AGENT_BOARD_NAME:-}"
  if [ -z "$n" ] && [ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_PANE_ID:-}" ]; then
    local herdr="${HERDR_BIN:-$(command -v herdr 2>/dev/null)}"
    local cache uid
    uid="$(id -u)"
    cache="${TMPDIR:-/tmp}/board-name-$uid-${HERDR_PANE_ID//[^A-Za-z0-9]/_}"
    # A name follows the pane's occupant, so the cache lives ten minutes, not forever.
    if [ -f "$cache" ] && [ -n "$(find "$cache" -mmin -10 2>/dev/null)" ]; then
      n="$(cat "$cache" 2>/dev/null)"
    elif [ -n "$herdr" ]; then
      n="$("$herdr" agent list 2>/dev/null | jq -r --arg p "$HERDR_PANE_ID" \
        '.result.agents[]? | select(.pane_id == $p) | .name // empty' 2>/dev/null | head -1)"
      printf '%s' "$n" > "$cache" 2>/dev/null
    fi
  fi
  n="$(printf '%s' "$n" | tr '[:upper:]' '[:lower:]')"
  case "$FLEET" in *" $n "*) [ -n "$n" ] && printf '%s' "$n" ;; esac
}

name="$(resolve_name)"
[ -n "$name" ] || exit 0

# Once per bird: subscribe to the fleet thread and tag, so a fleet-wide post reaches the
# bird and not only a post addressed to it by name (on 2026-10-18 five of six birds had no
# subscription). `subscribe` is idempotent; the marker only saves the call.
mark="${AGENT_BOARD_DIR:-$HOME/.agent-board}/hook/subscribed-$name"
if [ ! -f "$mark" ]; then
  "$BOARD" --as "$name" subscribe 1 >/dev/null 2>&1 &&
    "$BOARD" --as "$name" subscribe tag:fleet >/dev/null 2>&1 &&
    mkdir -p "$(dirname "$mark")" 2>/dev/null && : > "$mark"
fi

case "$mode" in
  inbox)
    event="$(printf '%s' "$payload" | jq -r '.hook_event_name // empty' 2>/dev/null)"
    interval="${BOARD_HOOK_INTERVAL:-300}"
    [ "$event" = "UserPromptSubmit" ] && interval=0
    printf '%s' "$payload" | "$BOARD" --as "$name" hook --interval "$interval" 2>/dev/null
    exit 0
    ;;
  finish)
    [ "${CLAUDE_ALLOW_NO_BOARD_POST:-}" = 1 ] && exit 0
    active="$(printf '%s' "$payload" | jq -r '.stop_hook_active // false' 2>/dev/null)"
    [ "$active" = "true" ] && exit 0
    transcript="$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)"
    [ -n "$transcript" ] && [ -r "$transcript" ] || exit 0
    # The last finishing command and the last board post, by position in this transcript.
    owed="$(python3 -I - "$transcript" <<'PY' 2>/dev/null
import json, re, sys
FINISH = re.compile(r"\bgh\s+pr\s+(create|ready)\b|tools/wt-done\.mjs")
POST = re.compile(r"agent-board\b.*\s(post|new)\s")
last_finish = last_post = -1
what = ""
with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
    for i, line in enumerate(fh):
        if '"tool_use"' not in line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        content = (rec.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict) or item.get("type") != "tool_use" or item.get("name") != "Bash":
                continue
            cmd = str((item.get("input") or {}).get("command", ""))
            if POST.search(cmd):
                last_post = i
            m = FINISH.search(cmd)
            if m:
                last_finish, what = i, m.group(0)
print(what if last_finish > last_post else "")
PY
)"
    [ -n "$owed" ] || exit 0
    reason="Board post owed: this session ran \`$owed\` after its last board post. Post a short finish note before you stop: what you finished, the PR number and its state, and what is next. Command: ~/.local/bin/agent-board --as $name post 1 - --kind note < note.md (ste-lint the note first). Set CLAUDE_ALLOW_NO_BOARD_POST=1 only when the owner says no post is wanted."
    jq -n --arg r "$reason" '{decision: "block", reason: $r}'
    exit 0
    ;;
esac
exit 0
