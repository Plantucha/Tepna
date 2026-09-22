#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-memory-stale.sh — PreToolUse(Read|Edit|Write) + PostToolUse(Edit|Write) guard against
# SILENTLY OVERWRITING a per-project MEMORY file another session wrote.
#
# THE FAILURE (residue 2026-09-03-memory-dir-has-no-stale-guard). Every fleet session writes to
# `~/.claude/projects/<project>/memory/` as the same unix user. On 2026-09-03 one session wrote
# `bands-cannot-detect-blindness.md`; minutes later another session Wrote its own version to the
# same path, having never read it, and the body was REPLACED wholesale — while the MEMORY.md index
# line survived, so the ledger kept pointing at a file whose content had silently changed authors.
# No conflict, no gate, no symptom. The directory is NOT in git: there is no merge-base to compare
# against, no `git log` to reconstruct from and no recovery. `guard-stale-brief.sh` is the same
# failure one directory over, and it has a base to measure against; this one does not.
#
# THE CHECK — the stale-brief shape with the file's own MTIME standing in for the git base:
#   · Read of a memory file  ⇒ RECORD `<path> <mtime_ns>` in this session's ledger.
#   · Edit/Write of a memory file that EXISTS ⇒ DENY unless the ledger holds that path with the
#     file's CURRENT mtime: "never read it this session" and "it changed since you read it" are the
#     two ways an overwrite drops someone's work, and both are decidable from the ledger alone.
#   · PostToolUse after our own Edit/Write ⇒ re-record the new mtime, so the session can keep
#     editing what it just wrote without re-reading it.
#   · A Write to a path that does not exist yet ⇒ ALLOW (a new memory is not an overwrite).
#   The ledger lives beside the memory dir, NOT inside it (`<project>/.memory-guard/<session_id>`),
#   so nothing the memory system indexes is polluted.
#
# ⚠ §2b-bis APPLIES, AND HERE IT BITES HARDER THAN ANYWHERE ELSE. This is a Claude Code PreToolUse
#   hook wired through `.claude/settings.json`: it runs ONLY for a session whose checkout has pulled
#   the wiring and this script. The memory directory is shared by EVERY session of the project —
#   including sessions running from a checkout that has not pulled it, and any other client — and
#   those sessions are UNGATED by this file. Because the directory is outside git, an overwrite by
#   such a session is undetectable after the fact; there is no CI counterpart to this guard. The only
#   agent-neutral protection is the harness's own read-before-Write rule, which does not cover the
#   read-then-someone-else-writes-then-you-write race this closes. Say that in any design that
#   leans on this guard; do not describe the memory dir as "protected".
#
# ⚠ FAILS OPEN on every leg where it cannot know: `jq` missing, no session id in the payload, a path
#   outside a `.claude/projects/*/memory/` directory, a Bash-side edit (`sed -i`, a heredoc — the same
#   residual gap the sibling guards document). Each fail-open leg is pinned in the self-test beside
#   the DENY it differs from by one property.
#
# Escape hatch: CLAUDE_ALLOW_STALE_MEMORY=1 — EXPORTED (an Edit/Write carries no command text, so an
# inline prefix cannot reach this process). Use it when you have read the file in another session
# and are deliberately writing over it; say so in the memory's own body.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
[ "${CLAUDE_ALLOW_STALE_MEMORY:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
payload="$(cat 2>/dev/null)" || exit 0
f="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
sid="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"
[ -z "$sid" ] && sid="${CLAUDE_CODE_SESSION_ID:-}"
[ -z "$f" ] && exit 0
[ -z "$sid" ] && exit 0
case "$sid" in *[!A-Za-z0-9._-]*) exit 0 ;; esac

# ── SCOPE: <anything>/.claude/projects/<project>/memory/<file> — the memory dir of ANY project. ──
case "$f" in
  */.claude/projects/*/memory/*) : ;;
  *) exit 0 ;;
esac
memdir="${f%/memory/*}/memory"
proj="${f%/memory/*}"
ledger_dir="$proj/.memory-guard"
ledger="$ledger_dir/$sid"
mtime_of() { stat -c '%.9Y' "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo ''; }   # ns precision where GNU stat has it — two writes inside one second must still differ

record() { # record <path> <mtime>
  mkdir -p "$ledger_dir" 2>/dev/null || return 0
  { [ -f "$ledger" ] && grep -v -F -- "$1	" "$ledger"; printf '%s\t%s\n' "$1" "$2"; } > "$ledger.tmp" 2>/dev/null && mv -f "$ledger.tmp" "$ledger" 2>/dev/null
  return 0
}

phase="${1:-pre}"   # `pre` (PreToolUse) or `post` (PostToolUse) — settings.json passes it
case "$tool" in
  Read)
    [ -f "$f" ] && record "$f" "$(mtime_of "$f")"
    exit 0 ;;
  Edit|Write|MultiEdit)
    if [ "$phase" = "post" ]; then
      [ -f "$f" ] && record "$f" "$(mtime_of "$f")"
      exit 0
    fi ;;
  *) exit 0 ;;
esac

# ── PreToolUse Edit/Write on a memory file ──────────────────────────────────────────────────────
[ -f "$f" ] || exit 0                       # a NEW memory is not an overwrite
now_mt="$(mtime_of "$f")"
seen_mt=""
[ -f "$ledger" ] && seen_mt="$(grep -F -- "$f	" "$ledger" 2>/dev/null | tail -1 | cut -f2)"
if [ -n "$seen_mt" ] && [ "$seen_mt" = "$now_mt" ]; then exit 0; fi
rel="${f#"$memdir"/}"
if [ -z "$seen_mt" ]; then
  why="this session has NOT read it (no Read recorded for it in this session's ledger)"
else
  why="it CHANGED since this session read it (read at mtime $seen_mt, now $now_mt — another session wrote it)"
fi
cat >&2 <<EOF2
BLOCKED: overwriting memory '$rel' — $why.

The memory directory is shared by every fleet session as one unix user, is NOT in git, and an
overwrite there leaves no conflict, no gate and no symptom (residue
2026-09-03-memory-dir-has-no-stale-guard: a body was replaced wholesale while its MEMORY.md index
line survived). Read the file first, then Edit it so the other author's text survives:

    Read  $f

If you have read it in another session and are deliberately writing over it, say so in the file and:

    export CLAUDE_ALLOW_STALE_MEMORY=1
EOF2
exit 2
