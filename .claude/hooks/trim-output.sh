#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# trim-output.sh — PreToolUse(Bash) rewriter. A command that can print thousands of
# lines is rewritten. The rewritten command prints the first 60 lines, one line that
# counts what it left out, and the last 40 lines. The full output goes to a file. The
# hook changes what reaches the transcript. It does not change what the command does.
#
# THE NUMBER FIRST, because the owner asked for the hook and not for a saving.
# Tool results are approximately 0.2M tokens a day across the fleet. That is less than
# 1 % of the spend. This hook is discipline, in the shape CLAUDE.md §4b already asks for
# ("never read a verdict off a tail"). Do not quote a saving for it. Nobody measured one.
#
# ⚠ IT NEVER SETS `permissionDecision`. The PreToolUse contract puts `updatedInput`
# under `hookSpecificOutput`, and `updatedInput` alone is legal: the rewritten call then
# goes through the normal permission flow. A hook that also sent
# `permissionDecision: "allow"` would approve the call with no prompt, and would step
# past the owner's permission mode. This hook sends `updatedInput`, and nothing else.
# `trim-output.test.sh` asserts the absence of that field.
#
# ⚠ `updatedInput` REPLACES the whole input object, so this hook rewrites `.command`
# inside a copy of the original `.tool_input`. A bare `{command:…}` would drop
# `description`, `timeout` and `run_in_background` — a silent change of behaviour.
#
# ⚠ THE REWRITTEN TEXT IS WHAT THE PERMISSION FLOW MATCHES, so a pre-approval keyed to
# the original text stops matching. Measured 2026-10-11: `.claude/settings.local.json`
# in this checkout holds 47 `Bash(…)` allow rules, 18 with a `*` and 29 exact. A
# rewritten command matches none of them, so each asks again until the owner approves
# the new shape. The committed `.claude/settings.json` holds 0 such rules, so the cost
# falls on a local file. This is the hook's price. It is not a defect to fix here.
#
# ⚠ THE SIZE TEST RUNS INSIDE THE WRAPPER, NOT IN THIS HOOK. A PreToolUse hook reads the
# command before the command runs, so it cannot know how many lines the command prints.
# The wrapper therefore captures the output every time, counts the lines, and prints the
# output unchanged at 200 lines or fewer. Only a longer output loses its middle. "Wrap
# only above 200 lines" is a statement about the OUTPUT, and the output does not exist
# yet at this point.
#
# ⚠ IT FAILS OPEN, which here means "pass the command through unchanged". Trimming is a
# convenience, so every doubt resolves to the original command. Six shapes pass through:
# a command that already bounds its own output, a command that writes to a file, a
# heredoc, a background command, a command that can end the shell (`exit`, `exec`), and
# an already-wrapped command. A `>` inside a quoted string reads as a file write and
# also passes through. That is the safe direction.
#
# ⚠ IT NEVER CHANGES THE EXIT CODE. The wrapper stores `$?` from the command itself and
# replays it with `( exit "$__trim_rc" )` in a subshell. A bare `exit` would end the
# session's shell, and `cd` must still persist, so the command runs in a brace group and
# the exit code travels in a subshell.
#
# Escape hatch: CLAUDE_ALLOW_UNTRIMMED=1 — passes every command through unchanged.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# The three numbers the wrapper uses. The test reads them from this file, so one edit
# here moves the behaviour and the test together.
TRIM_HEAD=60
TRIM_TAIL=40
TRIM_THRESHOLD=200

# The hatch, from the environment. An `Edit` or a `Write` sees only the exported form.
[ "${CLAUDE_ALLOW_UNTRIMMED:-}" = "1" ] && exit 0

payload="$(cat 2>/dev/null)" || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$cmd" ] && exit 0

# The settings matcher already selects Bash. This repeats the test, because a hook that
# rewrote an `Edit` input would corrupt a file.
tool="$(printf '%s' "$payload" | jq -r '.tool_name // "Bash"' 2>/dev/null)"
[ "$tool" = "Bash" ] || exit 0

# A background command streams to its own log, and the harness reads that log. Leave it.
bg="$(printf '%s' "$payload" | jq -r '.tool_input.run_in_background // false' 2>/dev/null)"
[ "$bg" = "true" ] && exit 0

# The hatch, inline on the command. The anchor is deliberate: a bare occurrence in an
# echo, a grep pattern or a heredoc line must not release the hook, or quoting the
# variable's name in prose would disable it. This is guard-stale-brief.sh's rule.
printf '%s' "$cmd" | grep -qE '(^|[;&|])[[:space:]]*CLAUDE_ALLOW_UNTRIMMED=1[[:space:]]' && exit 0

# ── THE SIX PASS-THROUGH SHAPES ────────────────────────────────────────────────
# Each one returns the command unchanged. None of them denies anything.

# 1 · Already wrapped. A session can copy a wrapped command out of the transcript and
#     run it again. One wrapper is enough.
case "$cmd" in *__trim_out*) exit 0 ;; esac

# 2 · A heredoc. The brace group would swallow the delimiter, and the body is data.
case "$cmd" in *'<<'*) exit 0 ;; esac

# 3 · A command that can end this shell, or replace it. `{ exit 1; }` inside the
#     session's own shell ends the session's shell.
printf '%s' "$cmd" | grep -qE '(^|[;&|(){}[:space:]])(exit|exec|trap|return|logout)([[:space:]]|$)' && exit 0

# 4 · A background command. `&&` and `>&` and `&>` are not backgrounding, so remove
#     those three first and then look for what remains.
if printf '%s' "$cmd" | sed 's/&&/+/g; s/[0-9]*>&[0-9-]*//g; s/&>//g' | grep -q '&'; then
  exit 0
fi

# 5 · A command that writes to a file. `2>&1` and `&>` are not file writes, and they are
#     already gone from the line above. Anything else holding a `>` keeps its own copy of
#     the output, so a second copy would help nobody. A `>` inside quotes lands here too,
#     and passing that through unchanged is the safe reading.
if printf '%s' "$cmd" | sed 's/[0-9]*>&[0-9-]*//g; s/&>//g' | grep -q '>'; then
  exit 0
fi

# 6 · A command that already bounds its own output. Read the LAST pipeline stage only,
#     because that stage decides what reaches the transcript. A command with no pipe
#     gives the whole command here, so a bare `head -5 f` is also bounded.
last="${cmd##*|}"
if printf '%s' "$last" | grep -qE '(^|[[:space:]])(head|tail|wc)([[:space:]]|$)'; then
  exit 0
fi
# `grep -c` and `uniq -c` count. Both need the name AND a `-c` in the same stage, so a
# `grep -i c` or a filename called `uniq` does not read as a count.
if printf '%s' "$last" | grep -qE '(^|[[:space:]])(grep|uniq)([[:space:]]|$)' \
  && printf '%s' "$last" | grep -qE '(^|[[:space:]])-[A-Za-z]*c([[:space:]]|$)'; then
  exit 0
fi

# ── BUILD THE WRAPPER ──────────────────────────────────────────────────────────
# The scratch file goes in the session's own scratchpad when the harness names one.
scratch="$(printf '%s' "$payload" | jq -r '.scratchpad_dir // empty' 2>/dev/null)"
[ -n "$scratch" ] && [ -d "$scratch" ] || scratch="${TMPDIR:-/tmp}"

# The original command sits on its own line inside the brace group. A trailing `#`
# comment would otherwise comment out the closing brace.
wrapped="$(printf '%s\n%s\n%s' \
"__trim_out=\"\$(mktemp '$scratch/trim-XXXXXX.log' 2>/dev/null || mktemp)\"; {" \
"$cmd" \
"} > \"\$__trim_out\" 2>&1; __trim_rc=\$?; __trim_n=\"\$(wc -l < \"\$__trim_out\" | tr -d ' ')\"; __trim_n=\"\${__trim_n:-0}\"; if [ \"\$__trim_n\" -le $TRIM_THRESHOLD ]; then cat \"\$__trim_out\"; else head -n $TRIM_HEAD \"\$__trim_out\"; printf '… %s lines omitted, full output: %s\\n' \"\$((__trim_n - $TRIM_HEAD - $TRIM_TAIL))\" \"\$__trim_out\"; tail -n $TRIM_TAIL \"\$__trim_out\"; fi; ( exit \"\$__trim_rc\" )")"

# `updatedInput` carries a copy of the original input, with `.command` replaced. No
# `permissionDecision` — see the header.
printf '%s' "$payload" | jq -c --arg c "$wrapped" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",updatedInput:(.tool_input + {command:$c})}}'
exit 0
