#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# trim-output.sh — PostToolUse(Bash). When a command printed more than 200 lines, the
# session sees the first 60 lines, one line that counts what is left out, and the last 40
# lines. The full output goes to a file, and the counting line names that file. The hook
# changes what reaches the transcript. The command has already run.
#
# UNTIL 2026-11-24 THIS WAS A PreToolUse REWRITER. It replaced the command with a wrapper
# through `updatedInput`, and the rewritten text is what the permission flow then reads. No
# allow rule matched it, so the auto-mode classifier judged each rewritten command. When the
# classifier gave no verdict, the call failed and the calls beside it in the same turn failed
# with it. A PostToolUse hook runs after the permission decision and never touches the
# command, so that failure cannot occur here.
#
# WHAT THIS SHAPE DOES NOT DO, all measured or read from the hook documentation:
#   · A command that exits non-zero goes to PostToolUseFailure, which cannot replace output.
#     That output stays whole, up to the limit of the Bash tool (30,000 characters).
#   · An output over that limit already reached a file, and the harness shows a preview. The
#     result then carries `persistedOutputPath`, and this hook leaves it alone.
#   · `updatedToolOutput` must have the shape of the tool result. The harness ignores another
#     shape. So this hook copies the original `tool_response` and replaces only the two text
#     fields.
#
# ⚠ IT NEVER SETS `permissionDecision` AND NEVER EXITS 2. `trim-output.test.sh` asserts both.
# Trimming is a convenience, so every doubt resolves to the original output: no jq, no
# scratch file, no text field, an image, a background task.
#
# THE SAVING: tool results are approximately 0.2M tokens a day across the fleet, less than
# 1 % of the spend. This hook is discipline (CLAUDE.md §4b, "never read a verdict off a
# tail"). Do not quote a saving for it. Nobody measured one.
#
# Escape hatch: CLAUDE_ALLOW_UNTRIMMED=1 — every output stays whole.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# The three numbers. The test reads them from this file, so one edit here moves the
# behaviour and the test together.
TRIM_HEAD=60
TRIM_TAIL=40
TRIM_THRESHOLD=200

# ⚠ STDIN IS DRAINED FIRST, BEFORE ANY EXIT. The harness writes the payload into this hook's
# stdin. A hook that exits before it reads leaves the writer on a closed pipe, and the writer
# dies on SIGPIPE (exit 141). `tools/hook-contract.mjs` holds every hook to this.
payload="$(cat 2>/dev/null)" || exit 0

# The hatch, from the environment.
[ "${CLAUDE_ALLOW_UNTRIMMED:-}" = "1" ] && exit 0

# One jq decides, so a small output costs one process. It answers `trim` only for a Bash
# result with text over the threshold that nothing else has shortened. `lines` counts as
# `wc -l` does, with a last line that has no newline counted too.
verdict="$(printf '%s' "$payload" | jq -r --argjson t "$TRIM_THRESHOLD" '
  def lines: if type != "string" or . == "" then 0 else (rtrimstr("\n") | split("\n") | length) end;
  if .tool_name == "Bash" and (.tool_response | type) == "object"
     and (.tool_response.isImage // false | not)
     and (.tool_response.persistedOutputPath // "") == ""
     and (.tool_response.backgroundTaskId // "") == ""
     and (.tool_input.run_in_background // false | not)
     and (((.tool_response.stdout | lines) > $t) or ((.tool_response.stderr | lines) > $t))
  then "trim" else "pass" end' 2>/dev/null)"
[ "$verdict" = "trim" ] || exit 0

# The hatch, inline on the command. The anchor is deliberate: a bare occurrence in an echo, a
# grep pattern or a heredoc line must not release the hook, or a command that quotes the name
# in prose would disable it. This is guard-stale-brief.sh's rule.
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
grep -qE '(^|[;&|])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*CLAUDE_ALLOW_UNTRIMMED=1[[:space:]]' <<<"$cmd" && exit 0

# The full output goes to the session's own scratchpad when the harness names one. No file
# means no trim: a counting line that names no copy would lose the middle for good.
scratch="$(printf '%s' "$payload" | jq -r '.scratchpad_dir // empty' 2>/dev/null)"
[ -n "$scratch" ] && [ -d "$scratch" ] || scratch="${TMPDIR:-/tmp}"
full="$(mktemp "$scratch/trim-XXXXXX.log" 2>/dev/null)" || exit 0
if ! printf '%s' "$payload" | jq -j '.tool_response | (.stdout // ""), (.stderr // "" | if . == "" then "" else "\n── stderr ──\n" + . end)' > "$full" 2>/dev/null; then
  rm -f "$full"
  exit 0
fi

# The payload travels on stdin and never as an argument, because one argv string cannot
# exceed MAX_ARG_STRLEN (131072 bytes on Linux).
out="$(printf '%s' "$payload" | jq -c --argjson t "$TRIM_THRESHOLD" --argjson h "$TRIM_HEAD" --argjson k "$TRIM_TAIL" --arg f "$full" '
  def trim: if type != "string" then . else (rtrimstr("\n") | split("\n")) as $l
    | if ($l | length) <= $t then . else
        ($l[:$h] + ["… \(($l | length) - $h - $k) lines omitted, full output: \($f)"] + $l[-$k:] | join("\n"))
      end end;
  {hookSpecificOutput: {hookEventName: "PostToolUse",
    updatedToolOutput: (.tool_response | (if has("stdout") then .stdout |= trim else . end)
                                       | (if has("stderr") then .stderr |= trim else . end))}}' 2>/dev/null)"
if [ -z "$out" ]; then
  rm -f "$full"
  exit 0
fi
printf '%s\n' "$out"
exit 0
