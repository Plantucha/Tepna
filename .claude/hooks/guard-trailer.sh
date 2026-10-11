#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-trailer.sh — PreToolUse(Bash) guard: a `git commit` whose message carries no
# `Fleet-Session: <Name>` line is denied, at the moment it can still be fixed for free.
#
# WHY AT COMMIT TIME, given `tools/pr-compliance.mjs` already requires the trailer.
# It is not a correctness gap — nothing without a trailer merges, because that gate is
# a REQUIRED context on `pull_request`. It is a COST gap, and a specific one: that gate
# reads the TRIGGER PAYLOAD, so editing the PR body afterwards does not re-run it
# (CLAUDE.md §📌). Fixing a missing trailer after the fact therefore costs an empty
# commit and a second CI round-trip, where fixing it here costs re-running one command.
#
# ⚠ THIS DOES NOT MAKE THE TRAILER A MECHANISM, AND CLAUDE.md IS STILL RIGHT.
# CLAUDE.md §👥.0 says the trailer is "a convention, not a mechanism — self-declared,
# unverified; never infer 'X did it'". Both halves of that survive this hook:
#
#   · SELF-DECLARED is untouched. This checks that a trailer is PRESENT. It cannot
#     check that the name is the session's own — nothing can, which is exactly why the
#     line says never infer authorship from it. A session may still write any name.
#   · NOT A MECHANISM holds outside Claude Code, which is most of the surface. This is
#     a `.claude/settings.json` PreToolUse hook, so it runs for a Claude Code session in
#     a checkout that has PULLED it — and for nothing else. A terminal commit, the GitHub
#     web UI, another agent, a CI bot and an un-pulled checkout all inherit nothing
#     (CLAUDE.md §👥.2: "Hook-enforced means Claude Code, in a checkout that has pulled
#     the hook"). The agent-neutral check remains `pr-compliance.mjs`; this is a
#     convenience in front of it, and deleting this file would change no invariant.
#
# ⚠ FAILS OPEN WHENEVER THE MESSAGE CANNOT BE READ, and that is most of the shapes:
# `git commit` with no `-m`/`-F` opens an EDITOR, so at PreToolUse time the message does
# not exist yet and there is nothing to examine. Guessing would deny a commit whose
# message is about to be written correctly. `-F -` reads stdin, which the hook cannot
# see either. In both cases: allow, and let the PR gate be the backstop it already is.
# Denying on an unreadable message would be the "success reported about something never
# examined" shape (CLAUDE.md §4b) wearing a refusal instead of a pass.
#
# ⚠ THE TREE IS THE COMMAND'S, NOT THE HOOK'S — the same defect that made
# guard-format.sh inert for every worktree commit until 2026-09-22, and
# guard-stale-brief.sh before it. The hook runs with the SESSION's cwd (the shared root
# for nearly every session) while CLAUDE.md §👥.1 mandates committing from a worktree.
# Only `--amend` needs the tree here, since that is the one shape whose message lives in
# the repository rather than in the command, but it is resolved the same way so the next
# reader does not have to wonder which tree was asked.
#
# Escape hatch: CLAUDE_ALLOW_NO_TRAILER=1 — for a throwaway or rescue commit.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

[ "${CLAUDE_ALLOW_NO_TRAILER:-}" = "1" ] && exit 0

payload="$(cat 2>/dev/null)" || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$cmd" ] && exit 0

# `git commit` only — not `git commit-tree`, not `--help`. Same matcher as guard-format.sh
# so the two guards agree on what a commit is.
printf '%s' "$cmd" | grep -qE '(^|[;&|]|\s)git\s+(-[^ ]+\s+|-C\s+\S+\s+)*commit(\s|$)' || exit 0
printf '%s' "$cmd" | grep -qE '\-\-help|\-h\b' && exit 0

# ── WHERE IS THE MESSAGE? ───────────────────────────────────────────────────────
# Three readable shapes and two unreadable ones. `msg` stays empty when unreadable.
msg=''
src=''

# 1 · -F/--file <path>. The fleet's normal form (a heredoc to a temp file, then -F), so
#     this is the shape that matters most. `-F -` is stdin: unreadable, allow.
mfile="$(printf '%s' "$cmd" \
  | grep -oE '(^|\s)(-F|--file)(=|[[:space:]]+)[^[:space:];&|]+' \
  | head -1 | sed -E 's/^.*(-F|--file)(=|[[:space:]]+)//' | tr -d '\042\047')"
mfile="${mfile/#\~/$HOME}"
if [ -n "$mfile" ] && [ "$mfile" != '-' ]; then
  if [ -r "$mfile" ]; then
    msg="$(cat "$mfile" 2>/dev/null)"
    src="-F $mfile"
  else
    # Named a file we cannot read — the commit will fail on its own terms, not ours.
    exit 0
  fi
fi

# 2 · -m/--message, possibly repeated. Quoting is the hard part and the reason this
#     reads the ARGV the harness recorded rather than re-parsing the shell: a message
#     containing `;` or a quoted `-m` inside prose would defeat a regex over the raw
#     string. jq gives us the command as the one string the harness has, so the fallback
#     below is a regex — but it only has to find the TRAILER, not reconstruct the message,
#     and the trailer is anchored to a line start.
if [ -z "$msg" ] && printf '%s' "$cmd" | grep -qE '(^|\s)(-m|--message)(=|[[:space:]])'; then
  msg="$cmd"
  src='-m'
fi

# 3 · --amend with neither: the message is HEAD's, which lives in the tree the command
#     names. Resolve that tree the way guard-format.sh does — §👥 lesson, see header.
if [ -z "$msg" ] && printf '%s' "$cmd" | grep -qE '(^|\s)--amend(\s|$)'; then
  tree="$(printf '%s' "$cmd" \
    | grep -oE '(^|[;&|]|\s)git\s+(-[^ ]+\s+)*-C\s+\S+\s+(-[^ ]+\s+)*commit(\s|$)' \
    | head -1 | sed -E 's/^.*-C[[:space:]]+([^[:space:]]+).*$/\1/' | tr -d '\042\047')"
  [ -z "$tree" ] && tree="$(printf '%s' "$cmd" \
    | grep -oE '(^|[;&|][[:space:]]*)cd[[:space:]]+([^[:space:];&|]+)' \
    | head -1 | sed -E 's/^.*cd[[:space:]]+//' | tr -d '\042\047')"
  tree="${tree/#\~/$HOME}"
  { [ -n "$tree" ] && [ -d "$tree" ]; } || tree="."
  msg="$(git -C "$tree" log -1 --format=%B 2>/dev/null)"
  src='--amend (HEAD)'
fi

# Unreadable (an editor commit, `-F -`, or an amend in a tree we cannot ask): ALLOW.
[ -z "$msg" ] && exit 0

# ── THE CHECK ───────────────────────────────────────────────────────────────────
# A line beginning `Fleet-Session:` followed by at least one letter. The NAME is not
# validated against the roster: CLAUDE.md keeps identities stable but also says the
# trailer is self-declared, and a hook that policed the name would be asserting an
# authorship claim this repo deliberately does not make. An empty `Fleet-Session:` is
# not a declaration, for the same reason `timeout-minutes: 0` is not a cap.
printf '%s' "$msg" | grep -qE '(^|[[:space:]])Fleet-Session:[[:space:]]*[A-Za-z]' && exit 0

cat >&2 <<EOF
BLOCKED: this commit message carries no \`Fleet-Session: <Name>\` trailer.

  message source: ${src:-unknown}

CLAUDE.md §👥.0 requires it in every commit message and PR body, and
\`tools/pr-compliance.mjs\` enforces it as a REQUIRED check on the PR. That gate reads the
trigger payload, so a body edit does NOT re-run it — fixing this after the fact costs an
empty commit and a second CI round-trip. Fixing it now costs re-running one command.

Add it as the last line (keep any Co-Authored-By / Claude-Session lines after it):

    Fleet-Session: <YourName>

⚠ The trailer is SELF-DECLARED and unverified — this guard checks only that one is
  present, never that the name is yours. Never infer "X did it" from it.

Throwaway or rescue commit? CLAUDE_ALLOW_NO_TRAILER=1
EOF
exit 2
