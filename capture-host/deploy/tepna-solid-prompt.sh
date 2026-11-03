#!/usr/bin/env bash
# tepna-capture — deploy/tepna-solid-prompt.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Every minute (vigil user crontab): deliver the daemon's solid-night prompt request to the session.
#
# Owner order, board thread 7 (2026-11-03): a non-PASS solid-night verdict prompts the investigating
# session at once, so it can find the cause, fix it and rerun the judge. The daemon cannot send that
# prompt: its unit runs with ProtectHome=yes, and the herdr socket lives in this user's home. So the
# daemon writes captures/solid-prompt.json (capture.py `_announce_solid`), and this script, which runs
# as the same user OUTSIDE the unit's sandbox, delivers it.
#
# One delivery per request: the delivered request is copied to .solid-prompt-done, and a request equal
# to that copy is not sent again. A failed or timed-out prompt is LOGGED and also marked done — a prompt
# is a courtesy, and a retry loop every minute would be worse than one lost prompt.
#
# The prompt is built from TWO CHECKED VALUES only: a YYYY-MM-DD night and one non-PASS verdict word.
# No other text from the request reaches the session.
#
# Paths: TEPNA_CAPTURES (default /srv/tepna/captures), TEPNA_HERDR (default ~/.local/bin/herdr),
# TEPNA_HERDR_SESSION (birds), TEPNA_HERDR_AGENT (wren), TEPNA_PROMPT_TIMEOUT (seconds, 20).
set -uo pipefail
CAP=${TEPNA_CAPTURES:-/srv/tepna/captures}
REQ=$CAP/solid-prompt.json
DONE=$CAP/.solid-prompt-done
LOG=$CAP/solid-prompt.log
HERDR=${TEPNA_HERDR:-$HOME/.local/bin/herdr}
SESSION=${TEPNA_HERDR_SESSION:-birds}
AGENT=${TEPNA_HERDR_AGENT:-wren}
TIMEOUT=${TEPNA_PROMPT_TIMEOUT:-20}

log() { printf '%s %s\n' "$(date -Is)" "$1" >> "$LOG"; }

[ -f "$REQ" ] || exit 0
req=$(cat "$REQ")
if [ -f "$DONE" ] && [ "$(cat "$DONE")" = "$req" ]; then exit 0; fi

night=$(sed -nE 's/.*"night": *"([0-9]{4}-[0-9]{2}-[0-9]{2})".*/\1/p' "$REQ" | head -n 1)
status=$(sed -nE 's/.*"status": *"(FAIL|SHORTFALL|UNDERPOWERED|NOT_RUN|NOT_APPLICABLE|UNKNOWN)".*/\1/p' "$REQ" | head -n 1)
if [ -z "$night" ] || [ -z "$status" ]; then
  log "SKIP unreadable request (no night or no non-PASS status)"
  printf '%s' "$req" > "$DONE"
  exit 0
fi

text="The capture box judged night $night as $status (solid-night). Read that night's solid-night verdict on the box. Find the cause. Fix it. Rerun the judge for that night."
if timeout "$TIMEOUT" "$HERDR" --session "$SESSION" agent prompt "$AGENT" "$text" >>"$LOG" 2>&1; then
  log "PROMPTED $AGENT: $night $status"
else
  log "PROMPT FAILED (exit $?): $night $status — logged only, not retried"
fi
printf '%s' "$req" > "$DONE"
