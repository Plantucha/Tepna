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
# ⚠ SCOPE (widened 2026-09-24, owner-ordered "find a way to enforce usage"): THREE shapes.
#   · `Edit|Write` of a repo file — the original.
#   · Bash `git commit` — the choke point. A computed edit through Bash (`sed -i`, a heredoc) is
#     still not gated at write time (a write-shape heuristic over every Bash command costs false
#     denials on reads, as guard-stale-brief.sh §3 records), but it has to be COMMITTED, and the
#     commit is. Only a commit: never reads, status, fetch, push.
#   · `SendMessage` — a coordinator's product is a ruling to a peer, not an edit. Measured
#     2026-09-24: twelve rulings on one search, two of them wrong and refuted by peers' measurements.
#   Each shape resolves the tree from ITS target (the file's dir; the command's `git -C`/`cd`, else
#   the payload cwd; the payload cwd), never this process's cwd.
#
# Escape hatch: CLAUDE_ALLOW_NO_DOC_SEARCH=1 — EXPORTED for Edit/Write/SendMessage (those carry no
# command text, so an inline prefix cannot reach this process; see guard-stale-brief.sh's header);
# for a `git commit` the inline form on the command line is ALSO read. Use it for a deliberate
# one-line fix you have already searched for in another session, and say so in the PR.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

[ "${CLAUDE_ALLOW_NO_DOC_SEARCH:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0

MAX_AGE_S="${DOC_SEARCH_MAX_AGE_S:-10800}"   # 3 h — overridable so the self-test can plant staleness

payload="$(cat 2>/dev/null)" || exit 0
f="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
pcwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)"

# ── THREE SHAPES, ONE FACT (owner-ordered 2026-09-24, "find a way to enforce usage"). ───────────
#   1. Edit/Write of a repo file — the original scope.
#   2. Bash `git commit` — the choke point every PR-bound change passes through, which closes the
#      `sed -i` / heredoc gap the header above declares: a computed edit still has to be committed.
#      Only a COMMIT is gated (never reads, status, fetch) so the false-denial cost of a write-shape
#      heuristic over every Bash command is not paid. The tree is resolved from the command's own
#      `git -C <dir>` / leading `cd <dir>`, then the payload's cwd — never this process's cwd
#      (guard-stale-brief.sh's lesson: the hook runs with the SESSION cwd).
#   3. SendMessage — the coordinator's product is a RULING sent to a peer, not an edit; measured
#      2026-09-24: one session issued a dozen rulings on one search, two of them wrong and refuted
#      by peers' measurements. A ruling is gated exactly like an edit: the session must have searched
#      within the window, in the repo its cwd sits in.
what=""; target_dir=""
if [ -n "$f" ]; then
  what="editing '$f'"
  target_dir="$(dirname "$f")"                       # the file may not exist yet (a Write)
elif [ -n "$cmd" ]; then
  # a commit, and not merely the word in prose: `git` … `commit` as separate words on one line
  printf '%s\n' "$cmd" | grep -qE '(^|[;&|(]|then |do )[[:space:]]*(sudo[[:space:]]+)?(env[[:space:]]+[^ ]+[[:space:]]+)*git([[:space:]]+-[A-Za-z]+([[:space:]]+[^ ]+)?)*[[:space:]]+commit([[:space:]]|$)' || exit 0
  # inline hatch on the command line itself (an Edit/Write cannot carry one; a command can)
  printf '%s\n' "$cmd" | grep -qE '(^|[[:space:]])CLAUDE_ALLOW_NO_DOC_SEARCH=1([[:space:]]|$)' && exit 0
  what="committing (\`$(printf '%s' "$cmd" | head -c 60 | tr '\n' ' ')…\`)"
  target_dir="$(printf '%s\n' "$cmd" | grep -oE 'git[[:space:]]+-C[[:space:]]+[^ ;&|]+' | head -1 | awk '{print $3}')"
  [ -z "$target_dir" ] && target_dir="$(printf '%s\n' "$cmd" | grep -oE '^[[:space:]]*cd[[:space:]]+[^ ;&|]+' | head -1 | awk '{print $2}')"
  [ -z "$target_dir" ] && target_dir="$pcwd"
  target_dir="${target_dir/#\~/$HOME}"
elif [ "$tool" = "SendMessage" ]; then
  what="sending a ruling to a peer (SendMessage)"
  target_dir="$pcwd"
else
  exit 0                                             # not a shape this guard judges
fi
[ -z "$target_dir" ] && exit 0
sid="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"
[ -z "$sid" ] && sid="${CLAUDE_CODE_SESSION_ID:-}"
[ -z "$sid" ] && exit 0
case "$sid" in *[!A-Za-z0-9._-]*) exit 0 ;; esac   # not a filename ⇒ no stamp could exist ⇒ not ours to judge

# ── WHICH TREE — from the target, never the hook's cwd (guard-stale-brief.sh's lesson). ─────────
edit_dir="$target_dir"
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

[ -n "$f" ] && what="editing '${f#"$root"/}'"
cat >&2 <<EOF
BLOCKED: $what without a semantic search this session — $why.

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
