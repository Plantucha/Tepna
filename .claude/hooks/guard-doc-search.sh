#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-doc-search.sh — PreToolUse(Edit|Write) guard: NO REPO EDIT WITHOUT A SEMANTIC SEARCH
# THIS SESSION. Owner-ordered 2026-09-12 ("give it teeth for local rig coders only").
#
# THE FAILURE. CLAUDE.md §📌 has mandated `node tools/doc-search.mjs "<question>"` before sizing
# or building since 2026-08-26, as a rule. Measured 2026-09-12: a two-root-cause diagnosis
# (firmware TX power + a bond-layer address mismatch) was done grep-first, and the search that
# ranks the PRIOR fix for the same bond layer at the top (CHANGELOG, `link_rssi.dbus_hci`) ran
# only after the owner asked "did you use bge?". Twice before that a session nearly reported
# build-from-scratch for machinery already in the tree (§📌's `pooledSeconds` case). A rule
# without a fact to check is a rule every session can honestly forget.
#
# THE FACT. `tools/doc-search.mjs` now leaves a STAMP after every search that actually ran —
# a file named by the Claude Code session, in the shared state dir (the git COMMON dir, so one
# stamp serves every worktree of this checkout, exactly like the index):
#
#     <git-common-dir>/tepna-mutation/doc-search-sessions/<session_id>
#
# This hook reads the payload's `session_id` (Claude Code's own, == $CLAUDE_CODE_SESSION_ID) and
# DENIES an Edit/Write INSIDE the repo unless that stamp exists and is fresh (≤ MAX_AGE_S). It is
# a per-session, per-window check: the first edit of a session forces the search, and a long
# session is asked again every few hours. It cannot know whether the search was the RIGHT
# question — that stays the rule; this is the part of it that can be mechanised.
#
# ⚠ "LOCAL RIG CODERS ONLY" — FAILS OPEN, by design, on every machine that cannot search:
#   · no `doc-search-index.json` in the state dir ⇒ this box has no bge index (fresh clones,
#     CI, other GitHub users — CLAUDE.md §📌 forbids pointing them at the tool) ⇒ ALLOW.
#   · no session id in the payload ⇒ not a Claude Code session ⇒ ALLOW.
#   · the edited path is outside a git repo, or its repo is not this checkout ⇒ ALLOW
#     (scratchpad, memory dir, /tmp).
#   · `jq` or `git` missing ⇒ ALLOW.
#   Every fail-open leg is pinned in the self-test, paired with the DENY it differs from by
#   ONE property, so a guard that fires on nothing scores as red as one that fires on everything.
#
# ⚠ SCOPE: the `Edit|Write` matcher only. A computed edit through Bash (`sed -i`, a heredoc)
#   is NOT gated — the same residual gap `guard-stale-brief.sh` §3 documents, left open here
#   rather than closed with a write-shape heuristic over every Bash command (that guard already
#   costs false denials on reads). Say so; do not describe this as covering Bash.
#
# Escape hatch: CLAUDE_ALLOW_NO_DOC_SEARCH=1 — EXPORTED (an Edit/Write carries no command text,
# so an inline prefix cannot reach this process; see guard-stale-brief.sh's header). Use it for a
# deliberate one-line fix you have already searched for in another session, and say so in the PR.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

[ "${CLAUDE_ALLOW_NO_DOC_SEARCH:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0

MAX_AGE_S="${DOC_SEARCH_MAX_AGE_S:-10800}"   # 3 h — overridable so the self-test can plant staleness

payload="$(cat 2>/dev/null)" || exit 0
f="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
[ -z "$f" ] && exit 0
sid="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"
[ -z "$sid" ] && sid="${CLAUDE_CODE_SESSION_ID:-}"
[ -z "$sid" ] && exit 0
case "$sid" in *[!A-Za-z0-9._-]*) exit 0 ;; esac   # not a filename ⇒ no stamp could exist ⇒ not ours to judge

# ── WHICH TREE — from the edited file, never the hook's cwd (guard-stale-brief.sh's lesson). ─────
#    The file may not exist yet (a Write), so resolve from its directory.
edit_dir="$(dirname "$f")"
[ -d "$edit_dir" ] || exit 0
root="$(git -C "$edit_dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -z "$root" ] && exit 0
common="$(git -C "$edit_dir" rev-parse --git-common-dir 2>/dev/null)" || exit 0
[ -z "$common" ] && exit 0
case "$common" in /*) : ;; *) common="$edit_dir/$common" ;; esac
state="$common/tepna-mutation"

# ── LOCAL RIG ONLY: no index ⇒ this machine cannot run the search ⇒ nothing to demand. ──────────
[ -f "$state/doc-search-index.json" ] || exit 0

stamp="$state/doc-search-sessions/$sid"
if [ -f "$stamp" ]; then
  now="$(date +%s)"
  mt="$(stat -c %Y "$stamp" 2>/dev/null || echo 0)"
  age=$(( now - mt ))
  [ "$age" -le "$MAX_AGE_S" ] && exit 0
  why="your last search was $(( age / 60 )) min ago (limit $(( MAX_AGE_S / 60 )) min)"
else
  why="no search has run in this session"
fi

rel="${f#"$root"/}"
cat >&2 <<EOF
BLOCKED: editing '$rel' without a semantic search this session — $why.

CLAUDE.md §📌 / MEMORY.md rule #0: run the search BEFORE any analysis, diagnosis, sizing or build,
and name the query + top hits in the first line of your report. Measured 2026-09-12: a diagnosis
done grep-first missed the prior fix for the same layer; the search ranked it first.

    node tools/doc-search.mjs "<what you are about to decide or build>"

Read the top hits — they are paths, not answers — then edit. The search leaves a per-session stamp
this hook reads; one search covers the next $(( MAX_AGE_S / 3600 )) h.

Deliberately skipping (a one-line fix already searched for elsewhere — say so in the PR):

    export CLAUDE_ALLOW_NO_DOC_SEARCH=1
EOF
exit 2
