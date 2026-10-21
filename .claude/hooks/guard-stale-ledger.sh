#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-stale-ledger.sh — PreToolUse(Bash|Read|Grep) guard against SIZING WORK FROM A
# STALE READ of the residue ledger.
#
# THE FAILURE, FOUR TIMES IN TWO DAYS, AND IT COSTS A CLAIM EACH TIME:
#
#   2026-10-20 05:05Z  a session read `briefs/RESIDUE.md` in the shared root, 11 commits
#                      behind, and claimed `2026-10-18-a-tz-test-restores-the-zone-by-
#                      deleting-tz` — closed as `fixed #3668` on the ref (board #401/#402).
#   2026-10-20 20:00Z  the SAME session, five hours after writing the remedy, enumerated
#                      OPEN rows with a grep in the root at 13 behind and named three rows
#                      main shows closed.
#   2026-10-21 04:40Z  a third session ran `grep -n '| OPEN |' briefs/RESIDUE.md` in the
#                      root at 14 behind, claimed `2026-10-20-seven-open-keyword-mutants-
#                      survive-in-writers`, and POSTED that claim to the fleet board. The
#                      row read ` fixed #3807 `. Two peers had to correct it.
#   (one earlier instance read stale SOURCE rather than a stale ledger — same mechanism,
#    different file; `memory/the-primary-checkout-is-not-origin-main.md` holds all of them.)
#
# WHY THE EXISTING REMEDY DID NOT STOP THE THIRD AND FOURTH. `tools/residue-ids.mjs --open`
# landed in #3777 and answers this question correctly. It is OPT-IN. A grep of the ledger in
# the shared root is the natural first move when picking a row, and nothing deflects it: the
# scan returns a well-formed table and no line of it says the file is fourteen commits old.
# Row `2026-10-20-the-stale-ledger-remedy-is-opt-in-and-the-failure-recurred` names that gap
# and asks whether a stale read can announce itself instead of waiting to be asked. This is
# that announcement.
#
# THE CRITERION IS THE FILE, NEVER THE COMMIT COUNT. `behindCommits` is the wrong question:
# the root is behind most of the time (`tepna-sync-main.timer` refuses to fast-forward while
# it holds uncommitted paths, and a dirty root is the normal state), and most of those commits
# never touch the ledger. So this hook compares the ROW STATES — `key \t state` extracted from
# the tree's own working copy against `origin/main:briefs/RESIDUE.md`. Identical states mean
# the read answers correctly however far behind the branch is, and the hook stays silent.
# Measured 2026-10-21 04:50Z in the shared root: 1 commit behind and 1 row differing, where
# ten minutes earlier it was 14 commits behind. The window is transient, which is exactly why
# an instrument a session must choose to run gets skipped on the reads that are wrong.
#
# ⚠ THE WORKING COPY IS THE POPULATION, NOT `HEAD`. A grep reads what is on disk, so that is
#   what has to be judged. A session with an uncommitted ledger row of its own is therefore
#   compared with that row present — it shows up as `onlyDisk` and never as a stale state, so
#   it cannot deny on its own work.
#
# ⚠ WHAT IS EXEMPT, AND WHY EACH ONE. Three command shapes NAME the ledger and do not read a
#   stale state, so denying them would deny this hook's own advice:
#     · `git show <ref>:briefs/RESIDUE.md` — reads the ref by construction.
#     · `node tools/residue-ids.mjs` — the documented pickup path; it reads the ref itself.
#     · `git log` / `git diff` / `git blame` / `git annotate` on the path — history, not state.
#   The test is PER CLAUSE: a compound command is split on `;` `&&` `||` `|` and newlines, and
#   the hook allows only when every clause that names the ledger is exempt. A single
#   `grep … briefs/RESIDUE.md` beside an exempt clause is still a stale read.
#
# ⚠ A HEREDOC BODY IS DATA. `guard-shared-tree.sh` got this rule in #2871 under the title "a
#   heredoc body is data for EVERY rule", and `guard-stale-brief.sh` did not — which denied a
#   peer writing a note and the hook's own author writing a reproduction script, twice in one
#   hour, because each body QUOTED a ledger path. A new hook that learns the class rule from
#   that history costs nothing; one that learns it from its own incident costs a session.
#
# ⚠ FAILS OPEN. No git, no local `origin/main`, no ledger on either side, an unborn HEAD: the
#   hook cannot know and allows. It guards a SIZING MISTAKE, not a correctness invariant, and
#   the cost of a wrong allow is one corrected claim while the cost of blocking every read on
#   a git hiccup is every session's first move.
#
# ⚠ AGENT-COUPLED, AND THERE IS NO AGENT-NEUTRAL HALF TO BUILD. CLAUDE.md §👥.2 pairs every
#   prevention with a detection in CI. Here the act is a session READING a file in a local
#   checkout: it leaves no commit, no PR and no artifact, so no CI job can observe it. The
#   detection half is `tools/residue-ids.mjs --open`, which a session or the owner runs; this
#   hook only removes the need to think of it first.
#
# Escape hatch: CLAUDE_ALLOW_STALE_LEDGER=1 — set it when you are reading a historic row and
# know the state on disk may be old. TWO forms, because a hook cannot see the environment of
# the command it gates (the same measurement as `guard-stale-brief.sh`, 2026-09-02):
#   * EXPORTED in the environment Claude Code runs in — the only form a Read or Grep can carry.
#   * a COMMAND-POSITION prefix inside a Bash command.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# ⚠ STDIN IS DRAINED FIRST, BEFORE ANY EXIT — `tools/hook-contract.mjs` is the gate. The harness
# writes this hook's tool-call JSON down a pipe, so an exit before the read strands the writer on a
# closed pipe and it takes SIGPIPE (141 under `pipefail`). The hatch is checked AFTER the drain.
payload="$(cat 2>/dev/null)" || exit 0
[ "${CLAUDE_ALLOW_STALE_LEDGER:-}" = "1" ] && exit 0

cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
f="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)"
[ -z "$cmd" ] && [ -z "$f" ] && exit 0

# The inline half of the hatch. COMMAND POSITION only — start of the command or straight after a
# `;`/`&&`/`||`/`|`/newline — so a bare occurrence in an echo, a grep pattern or a heredoc line
# cannot release the guard. Quoting the variable's name in prose must not switch it off.
printf '%s' "${cmd:-}" | grep -qE '(^|[;&|])[[:space:]]*CLAUDE_ALLOW_STALE_LEDGER=1[[:space:]]' && exit 0

LEDGER='briefs/RESIDUE.md'

# ── A HEREDOC BODY IS DATA ────────────────────────────────────────────────────
#    Drop every heredoc body before any matching below. An UNQUOTED delimiter still expands
#    variables, but it is still data as far as "which files does this command read" goes, so both
#    forms are dropped. The terminator is matched with optional leading tabs for `<<-`.
code="$cmd"
if printf '%s' "$cmd" | grep -q '<<'; then
  code="$(printf '%s\n' "$cmd" | awk '
    BEGIN { indq = 0 }
    {
      if (indq) { if ($0 ~ dq) { indq = 0 }; next }
      line = $0
      if (match(line, /<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?/)) {
        tag = substr(line, RSTART, RLENGTH)
        gsub(/^<<-?[[:space:]]*/, "", tag); gsub(/["'"'"']/, "", tag)
        dq = "^[[:space:]]*" tag "[[:space:]]*$"
        indq = 1
      }
      print line
    }')"
fi

# ── DOES ANY NON-EXEMPT CLAUSE NAME THE LEDGER? ───────────────────────────────
#    Per clause, never per command: an exempt clause beside a stale read must not cover for it.
names_ledger=""
if [ -n "$f" ]; then
  case "$f" in *"$LEDGER") names_ledger=1 ;; esac
fi
if [ -z "$names_ledger" ] && [ -n "$code" ]; then
  while IFS= read -r clause; do
    case "$clause" in *"$LEDGER"*) : ;; *) continue ;; esac
    # `git show <ref>:<path>` reads the ref, which is the remedy this hook prints.
    printf '%s' "$clause" | grep -qE '\bgit\b.*\bshow\b.*:[^[:space:]]*'"$LEDGER" && continue
    # The documented pickup path reads the ref itself.
    printf '%s' "$clause" | grep -q 'residue-ids\.mjs' && continue
    # History, not state.
    printf '%s' "$clause" | grep -qE '\bgit\b.*\b(log|diff|blame|annotate)\b' && continue
    names_ledger=1
    break
  done <<CLAUSES
$(printf '%s\n' "$code" | tr ';|&' '\n')
CLAUSES
fi
[ -z "$names_ledger" ] && exit 0

# ── RESOLVE THE TREE THE READ WILL ACTUALLY HAPPEN IN ─────────────────────────
#    An absolute `file_path`/`path` names it. Otherwise the first EXISTING `cd` target in the
#    command names it. With neither signal the hook's own cwd is the answer and is RIGHT here,
#    unlike in `guard-stale-brief.sh`: a bare `grep … briefs/RESIDUE.md` runs in the shared root,
#    which is the checkout this hook stands in and the one every recorded instance read.
read_dir="."
case "$f" in /*) read_dir="$(dirname "$f")" ;; esac
if [ "$read_dir" = "." ] && [ -n "$code" ]; then
  cd_dir="$(printf '%s' "$code" \
    | grep -oE '(^|[;&|][[:space:]]*)cd[[:space:]]+([^[:space:];&|]+)' \
    | head -1 | sed -E 's/^.*cd[[:space:]]+//' | tr -d '\042\047')"
  [ -n "$cd_dir" ] && [ -d "$cd_dir" ] && read_dir="$cd_dir"
fi
[ -d "$read_dir" ] || read_dir="."

root="$(git -C "$read_dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -z "$root" ] && exit 0
[ -f "$root/$LEDGER" ] || exit 0
git -C "$root" rev-parse --verify --quiet origin/main >/dev/null 2>&1 || exit 0

# ── THE COMPARISON: ROW STATES, DISK AGAINST THE REF ──────────────────────────
#    `key \t state` per row. Seven pipes per row is the ledger's own shape (CLAUDE.md §📌), so
#    field 2 is the key and the last field is the state. A line that is not a six-cell row is not
#    a row and is skipped, which is what keeps the table's own prose and header out of the count.
states() {
  awk '
    # ⚠ AN ESCAPED PIPE STAYS INSIDE ITS CELL. 46 lines of the ledger carry `\|` in a defect or
    #   evidence cell, and a naive split on `|` gives them the wrong field count and drops them
    #   from the population — so a stale state on exactly one of those rows would not deny. The
    #   rule is `tools/residue-ids.mjs:splitRowCells` (landed 4876a4407): protect a DOUBLED
    #   backslash first, so the pipe after it stays live, then protect `\|`, then split.
    /^\|/ {
      line = $0
      gsub(/\\\\/, "\001", line)
      gsub(/\\\|/, "\002", line)
      n = split(line, c, "|")
      if (n != 8) next                     # | k | logged | source | defect | evidence | state |
      key = c[2]; lg = c[3]; st = c[7]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", lg)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", st)
      # A POSITIVE SHAPE TEST, NOT A HEADER BLOCKLIST. The header row of the table has six cells
      #   too, so a bare field count admits it: measured 714 rows against 713 from the pickup
      #   tool. The logged column of a real row is a date, which no header or rule line is, so
      #   requiring that shape costs nothing and needs no list of lines to skip.
      if (lg !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) next
      if (key == "" || key ~ /^-+$/) next
      print key "\t" st
    }' | LC_ALL=C sort -u
}
disk="$(states < "$root/$LEDGER")" || exit 0
ref="$(git -C "$root" show "origin/main:$LEDGER" 2>/dev/null | states)" || exit 0
[ -z "$disk" ] && exit 0
[ -z "$ref" ] && exit 0

# A row whose KEY is on both sides and whose STATE differs. A key present on only one side is not
# a stale state: on disk only it is this session's own new row, and on the ref only it is a row
# this tree has not pulled, which no read of it can get wrong.
both_keys="$(LC_ALL=C comm -12 <(printf '%s\n' "$disk" | cut -f1 | LC_ALL=C sort -u) \
                               <(printf '%s\n' "$ref"  | cut -f1 | LC_ALL=C sort -u))"
[ -z "$both_keys" ] && exit 0

differ=0; stale_open=0; first_row=""; first_disk=""; first_ref=""
while IFS= read -r k; do
  [ -z "$k" ] && continue
  d="$(printf '%s\n' "$disk" | awk -F'\t' -v k="$k" '$1 == k { print $2; exit }')"
  r="$(printf '%s\n' "$ref"  | awk -F'\t' -v k="$k" '$1 == k { print $2; exit }')"
  [ "$d" = "$r" ] && continue
  differ=$((differ + 1))
  [ "$d" = "OPEN" ] && stale_open=$((stale_open + 1))
  if [ -z "$first_row" ]; then first_row="$k"; first_disk="$d"; first_ref="$r"; fi
done <<KEYS
$both_keys
KEYS

[ "$differ" -eq 0 ] && exit 0

behind="$(git -C "$root" rev-list --count HEAD..origin/main 2>/dev/null)"
branch="$(git -C "$root" branch --show-current 2>/dev/null)"

cat >&2 <<EOF
BLOCKED: this checkout's $LEDGER disagrees with origin/main on $differ row state(s) — $stale_open of them read OPEN here and are CLOSED on the ref.

  first disagreement: $first_row
    on disk        : $first_disk
    on origin/main : $first_ref

MEASURED AGAINST: $root (on ${branch:-detached}, ${behind:-unknown} commit(s) behind origin/main)

A row that reads OPEN here and is closed on the ref is a claim on work someone else finished.
That has happened four times in two days, and the fourth reached the fleet board: a session
read this file in the shared root at 14 commits behind, claimed a row that said \` fixed #3807 \`,
and two peers spent a turn each correcting it. The scan returns a well-formed table every time
and no line of it says the file is old, which is why this is a guard and not a convention.

READ THE LEDGER FROM THE REF, which is correct whatever this checkout is at:

    git show origin/main:$LEDGER | grep '| OPEN |'

Or ask the pickup tool, which names every row this read gets wrong:

    node tools/residue-ids.mjs --open

Or size the row from a fresh worktree cut from the ref (CLAUDE.md §👥.1), where the file is
current by construction and this guard is silent.

If you are reading a historic row and know the state here may be old, say so:

    CLAUDE_ALLOW_STALE_LEDGER=1 <your bash command>      (command position — read from the text)
    export CLAUDE_ALLOW_STALE_LEDGER=1                   (REQUIRED for a Read or a Grep: those
                                                          carry no command text, so the variable
                                                          must already be in this hook's own
                                                          environment)

(This reads your LOCAL origin/main and never fetches, so it can only UNDER-report.
 \`git fetch origin main\` first if it matters.)
EOF
exit 2
