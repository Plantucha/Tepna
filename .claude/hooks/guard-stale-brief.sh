#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-stale-brief.sh — PreToolUse(Edit|Write|Bash) guard against SILENTLY OVERWRITING
# a brief that someone else already answered.
#
# THE FAILURE, twice on one file in one day (2026-08-08, GENERATOR-FOLLOWUPS-III):
#
#   #1016 created the brief with §1/§2 as open questions.
#   #1034 answered §2 — MotionDex accidental, proven by EXECUTION (31,200 parsed rows).
#   #1050 answered §1 — swept 6 park claims, found 2 stale.
#   #1055 answered §1 and §2 again, from a branch based BEFORE #1034 — and the squash
#         took it, dropping #1034's answer entirely.
#
# Nothing conflicted. Git had no overlapping hunk to complain about, so no rebase was
# triggered and no CI check could see it: the brief simply lost a better-evidenced
# answer and sat for two commits CONTRADICTING ITS OWN §4. Then it happened AGAIN —
# two sessions independently wrote the same reconciliation (#1059, #1061), because
# neither could see the other coming either.
#
# THE CHECK. Not "did you remember to look" — that is unenforceable. Instead: is your
# base actually stale FOR THIS FILE?
#
#     git log <merge-base HEAD origin/main>..origin/main -- <the brief>
#
# Non-empty ⇒ commits touching this exact brief exist on origin/main that your branch
# does not contain ⇒ editing it now can silently drop them. That is precisely the
# condition that bit #1055, and it is cheap to evaluate.
#
# ⚠ FRESHNESS — AND THE DIRECTION DEPENDS ON *WHICH* REF IS STALE. This reads the LOCAL
# `origin/main`; it never fetches (a PreToolUse hook must not block on the network).
#   · A stale `origin/main` makes it UNDER-report: commits it has not seen cannot be
#     listed. `CLAUDE.md` §📌 therefore says fetch first.
#   · A stale HEAD makes it OVER-report, and the sentence here used to deny that. The
#     base is `merge-base(HEAD, origin/main)` of the tree this hook RESOLVES, so if that
#     tree has fallen behind, the range lists commits the tree the author is actually
#     editing may already contain — a FALSE DENIAL. Measured 2026-08-20: three in one
#     session. Residue `2026-09-05-sync-main-skips-while-root-dirty` names the mechanism
#     that keeps it stale: `tepna-sync-main.timer` refuses to fast-forward the shared root
#     while it holds uncommitted paths (correct, and not to be changed), and a dirty root
#     is the normal state — measured 42 commits behind at 02:15 on rig-x870 with 7 dirty
#     paths, while `systemctl show` still reported `Result=success`.
#   So "can only under-report" is TRUE of the ref and FALSE of the tree. It is not a
#   blanket property of this hook, and it was stated as one.
#
# ⚠ WHICH TREE IS RESOLVED IS THEREFORE THE WHOLE QUESTION, and it is settled by the
#   payload, not by the hook's cwd. An ABSOLUTE `file_path`, or a leading `cd <dir>` in a
#   Bash command, names the tree and the answer is about THAT tree — verified by the
#   stale-root block in the self-test: with the root 1 commit behind and a worktree at
#   `origin/main`, both routes ALLOW an edit in the worktree and both still DENY one in
#   the stale tree. With NEITHER signal the hook measures its own cwd, and there it can
#   deny only while that tree is stale (a current tree makes the base `origin/main` and
#   the range empty by construction) — which is exactly when the answer is unreliable.
#   That residual route is pinned in the self-test as the behaviour it HAS, not endorsed.
#
# ⚠ FAILS OPEN, deliberately, and this is the one place that choice is right. If git
# is unavailable, `origin/main` is missing, or HEAD is unborn, the guard cannot know —
# and blocking every documentation edit on a git hiccup would cost far more than the
# bug it prevents. It guards a WRITE-OVER, not a correctness invariant; the CLAUDE.md
# rule is the backstop. (Contrast `tools/rebase-safe.mjs`, which fails CLOSED because
# there a wrong guess reverts source.)
#
# ⚠ SCOPE. This covers the SEQUENTIAL collision — the other work has merged and you have
# fetched. It structurally CANNOT cover the CONCURRENT one (two PRs open at once, neither
# merged), because the information does not exist on any ref for it to read. That half is
# `.github/workflows/stale-file.yml`, which reads the real ref on the PR. Do not describe
# this hook as covering the concurrent case — BRIEF-COLLISION-RESIDUAL-GAP §5.
#
# Escape hatch: CLAUDE_ALLOW_STALE_BRIEF=1 — set it when you have READ the commits it
# names and are deliberately writing over them. TWO forms, because a hook cannot see the
# environment of the command it is gating:
#   * EXPORTED in the environment Claude Code runs in — the only form that reaches the
#     Edit/Write path, where there is no command text to carry a prefix.
#   * a COMMAND-POSITION prefix inside a Bash command (`… && CLAUDE_ALLOW_STALE_BRIEF=1 git
#     rebase …`). Measured 2026-09-02: this hook runs as a separate process BEFORE the command
#     it gates, so an inline prefix never reaches the check at line ~54 — while both this
#     hook's own denial text and CLAUDE.md §📌 presented it as if it did. A session that had
#     read the upstream commits and reached for the documented hatch was denied anyway, twice,
#     with no way to tell the hatch from a broken guard. Honouring it here makes the
#     documentation true rather than making the guard weaker: the prefix is self-declared
#     exactly like the exported form, and the operator typing it is making the same claim.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

[ "${CLAUDE_ALLOW_STALE_BRIEF:-}" = "1" ] && exit 0

# stdin is readable ONCE, and this hook now asks it two questions (Edit/Write carry a
# `file_path`; Bash carries a `command`), so the payload is buffered rather than piped twice.
payload="$(cat 2>/dev/null)" || exit 0
f="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$f" ] && [ -z "$cmd" ] && exit 0

# The inline half of the hatch (see the header). COMMAND POSITION only — start of the command,
# or straight after a `;`/`&&`/`||`/`|`/newline — so the assignment has to be one the shell would
# actually apply. A bare occurrence anywhere in the text (an echo, a grep pattern, a here-doc
# line) must NOT release the guard, or quoting the variable's name in prose would disable it.
# One line and guarded: a bare `exit 0` on its own line is the dead-code shape this hook's own
# self-test refuses, because one of those short-circuits the guard into a no-op while every
# behavioural leg still reads green.
printf '%s' "${cmd:-}" | grep -qE '(^|[;&|])[[:space:]]*CLAUDE_ALLOW_STALE_BRIEF=1[[:space:]]' && exit 0

# ── RESOLVE THE REPOSITORY FROM THE EDITED FILE, NOT FROM THE HOOK'S CWD ───────
#    A PreToolUse hook runs with cwd = $CLAUDE_PROJECT_DIR (the shared root). CLAUDE.md §👥.1
#    MANDATES working in a private worktree, so in the real deployment the tree being EDITED is
#    almost never the tree this process is standing in — and every `git` below silently answered
#    about the wrong one. Two independent defects, both fixed by `-C`:
#      · `--show-toplevel` returned the ROOT, so `rel="${f#"$root"/}"` failed to strip a path from
#        another worktree, `cands` came out empty, and the hook ALLOWED.
#      · `merge-base HEAD origin/main` read the ROOT's HEAD, so staleness was asked of a tree the
#        author was not editing.
#    Measured 2026-08-18: with the root at origin/main (which `tepna-sync-main.timer` now keeps it
#    at, every 15 min) `base` IS `origin/main`, so `base..origin/main` is empty BY CONSTRUCTION and
#    the guard allowed EVERY edit, repo-wide. It could only ever block while the root was stale —
#    i.e. it worked only while the root was broken, and fixing the root silently switched it off.
#    See briefs/STALE-BRIEF-GUARD-MEASURES-THE-WRONG-TREE-2026-08-18-BRIEF.md.
#
#    ⚠ The Bash path has no file argument, so it still falls back to the hook's cwd. That residual
#      gap is documented rather than hidden: a computed edit from a worktree is measured against the
#      root until the payload carries a cwd we can trust.
edit_dir="."
cd_missing=""
[ -n "$f" ] && edit_dir="$(dirname "$f")"

# ── THE BASH ROUTE'S TREE, from a leading `cd` ────────────────────────────────
#    The gap the block above documents: a computed edit carries no file_path, so `edit_dir`
#    stayed "." — the hook's cwd, i.e. the shared root — and staleness was asked of a tree the
#    author was not editing. Measured 2026-08-20: three consecutive FALSE DENIALS in one session,
#    each naming a commit the editing worktree already contained, because the root had drifted a
#    few commits behind while the worktree was current.
#
#    A computed edit in this repo almost always announces its tree, because CLAUDE.md §👥.1
#    mandates a worktree and the hook's own cwd is the root: the command opens `cd <worktree> &&`.
#    Take the FIRST such `cd` — later ones in a compound command are subdirectory hops, and the
#    repo toplevel resolves the same from either. Anything unparseable leaves `edit_dir` alone, so
#    this can only ever move the query CLOSER to the edited tree, never further.
if [ -z "$f" ] && [ -n "$cmd" ]; then
  cd_dir="$(printf '%s' "$cmd" \
    | grep -oE '(^|[;&|][[:space:]]*)cd[[:space:]]+([^[:space:];&|]+)' \
    | head -1 | sed -E 's/^.*cd[[:space:]]+//' | tr -d '\042\047')"
  #    ⚠ THE TREE MAY NOT EXIST YET, AND THEN THIS BASE IS THE ROOT'S. A command that CREATES its
  #      worktree and edits a guarded file in the same invocation — `git worktree add <p> && cd <p>
  #      && cat >> briefs/X.md` — reaches this hook BEFORE the directory exists, so `-d` fails and
  #      `edit_dir` stays at the hook's cwd (the shared root). The verdict is then measured against
  #      a tree the author is not editing, and the root is the checkout §👥.2b-bis names as most
  #      likely to be stale: measured 2026-09-10, 33 commits behind, producing a denial listing ten
  #      commits the new worktree already contained.
  #
  #      NOT SILENTLY REPAIRED, because it cannot be: at PreToolUse time there is no tree to ask, so
  #      any base would be a guess. It fails CLOSED (deny), which is the safe direction — the
  #      dangerous one is the false NEGATIVE this guard was rewritten to remove. What IS fixed is the
  #      message: a denial that cannot explain itself teaches the reader to reach for the escape
  #      hatch reflexively, and a guard whose hatch is reflex is the guard that fails the day it is
  #      right. `cd_missing` carries that fact into the report.
  #      ⚠ AND `cd_missing` IS SCANNED OVER EVERY `cd`, NOT ONLY THE FIRST. The first-cd rule above
  #      is right for choosing the BASE (later ones are subdirectory hops), and wrong for detecting a
  #      not-yet-created tree: measured 2026-09-23 on
  #          cd <root> && git worktree add <wt> && cd <wt> && <edit>
  #      the first `cd` was the ROOT — which exists, so `cd_missing` stayed empty — and the denial
  #      reported 91 commits with no tree named beside them, against a worktree that was AT
  #      origin/main with 0 behind. The root must be the first `cd`: it is where `git worktree add`
  #      runs. A missing DIRECTORY is never a subdirectory hop, so the head -1 rule has no claim on
  #      it; take the first cd that does NOT exist, wherever it sits in the command.
  for _cdd in $(printf '%s' "$cmd" \
    | grep -oE '(^|[;&|][[:space:]]*)cd[[:space:]]+([^[:space:];&|]+)' \
    | sed -E 's/^.*cd[[:space:]]+//' | tr -d '\042\047'); do
    if [ ! -d "$_cdd" ]; then
      cd_missing="$_cdd"
      break
    fi
  done
  [ -n "$cd_dir" ] && [ -d "$cd_dir" ] && edit_dir="$cd_dir"
fi

[ -d "$edit_dir" ] || edit_dir="."

# Repo-relative, so an absolute path from the tool matches the same rule as a relative one.
root="$(git -C "$edit_dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -z "$root" ] && exit 0

# ⚠ NAME THE TREE THAT CONVICTED YOU, ALWAYS. A denial that reports only a commit COUNT cannot be
#   told apart from one measured against a checkout the author is not editing — and the fallback tree
#   is the shared root, which §👥.2b-bis names as the one most likely to be stale. Measured
#   2026-09-23: "91 commit(s) you do not have" against a worktree that was AT origin/main, 0 behind,
#   because the base had fallen back to a root 168 commits behind on a feature branch. The verdict
#   was fail-closed and defensible; the REPORT was unreadable. One line makes a real staleness and a
#   misresolved one differ by inspection instead of by re-derivation. Same shape as #2896 teaching
#   guard-format to say which tree it read.
base_dir_label="$root"
[ "$root" = "$(git rev-parse --show-toplevel 2>/dev/null)" ] && base_dir_label="$root (this hook's cwd — NOT necessarily the tree you are editing)"
_bhd="$(git -C "$root" rev-list --count HEAD..origin/main 2>/dev/null)"
_brn="$(git -C "$root" branch --show-current 2>/dev/null)"
behind_label="on ${_brn:-detached}, $( [ -n "$_bhd" ] && echo "$_bhd commit(s) behind origin/main" || echo 'distance from origin/main unknown' )"

# ⚠ ANCHOR EVERY LATER QUERY AT `$root`, NOT AT `$edit_dir`. `git -C <dir>` also makes PATHSPECS
#   relative to <dir>, so `-- briefs/X.md` from inside `briefs/` looks for `briefs/briefs/X.md` and
#   matches nothing — which reads as "did not move upstream" and ALLOWS. The first draft of this fix
#   did exactly that and turned three DENY cases into ALLOWs; the self-test's anti-vacuity legs are
#   what caught it. `$root` is the edited file's own worktree toplevel, so pathspecs resolve as the
#   guarded-set rule already assumes.
G() { git -C "$root" "$@"; }

# GUARDED SET — the hot shared docs. `briefs/*.md` is where the collision happened;
# DOCS-INDEX.md is the dashboard every brief change touches, so it collides for the
# same reason and by the same mechanism.
GUARDED_RE='(briefs/[A-Za-z0-9._@+-]+\.md|DOCS-INDEX\.md)'

# ── §3 of BRIEF-COLLISION-RESIDUAL-GAP: the matcher was `Edit|Write`, which is a TOOL
#    name and not a file write. Every computed edit — `python3 - <<'PY'`, `cat > f`,
#    `sed -i` — arrives through `Bash` and bypassed this guard completely. That is not a
#    hypothetical: the session that WROTE that brief made four such edits to DOCS-INDEX.md
#    and a brief, all unguarded, because placing a table row is easier to compute than to
#    hand-write. The sibling `guard-shared-tree.sh` matches `Bash` for exactly this reason.
#
#    A command is only inspected when it is WRITE-SHAPED. Naming a brief is not enough —
#    this hook's own remedy tells you to run `git log -p … -- <brief>`, and a guard that
#    denied its own advice would be worse than the gap. So: a redirect/tee/cp/mv aimed at a
#    guarded path, an in-place sed, or an interpreter opening a file for writing.
#
#    ⚠ It is a HEURISTIC over shell text, and it is tuned to over- rather than under-fire:
#    a read piped into a file (`grep x briefs/A.md > /tmp/o`) is write-shaped by this rule.
#    That costs a denial only when the brief ACTUALLY moved upstream — the staleness query
#    still gates every path — and the message names the commits and the escape hatch.
# ── A HEREDOC BODY IS DATA — AND THIS HOOK WAS THE SIBLING THAT NEVER GOT THE RULE ─────────────
#    #2871 gave `guard-shared-tree.sh` the data-vs-code rule under the title "a heredoc body is
#    data for EVERY rule". "Every rule" meant every rule INSIDE THAT HOOK; this one never got it,
#    and the gap is the half-wired-mechanism shape: a fix applied at the site it was found and not
#    to the class. Measured 2026-09-22, twice in one hour and in opposite lanes — a peer writing a
#    note to the MEMORY directory (no repo file touched at all) and this hook's own author writing
#    a reproduction script were both DENIED, because each command's heredoc body QUOTED a ledger
#    path, and one of them quoted a `sed -i` in a string literal. Describing a file read as editing
#    it, and the remedy the denial printed was to go and read 75 commits that had nothing to do
#    with either command.
#
#    The line is DATA-vs-CODE and the shell already draws it: a heredoc body is data UNLESS the
#    heredoc feeds an interpreter (`python3 - <<PY`, `bash <<EOF`), where the body IS the program —
#    which is precisely the computed-edit case §3 added Bash matching for, so those bodies must stay
#    visible. Lifted verbatim from the sibling rather than re-derived, including its fail-closed
#    terminator rule; `guard-stale-brief.test.sh` asserts the two copies stay byte-identical, so the
#    next fix to one cannot silently skip the other again.
# The sibling folds continuations and newlines into spaces BEFORE stripping, and that fold is
# LOAD-BEARING rather than cosmetic: `sed` is line-oriented, so with real newlines the opener and
# the terminator sit on different lines and the strip silently matches nothing. Measured while
# porting this: without the fold, three of the four new test legs still passed — for reasons that
# had nothing to do with stripping — and only the prose-`sed -i` leg exposed that the rule was
# doing nothing at all.
cmdf="${cmd//\\$'\n'/ }"; cmdf="${cmdf//$'\n'/ }"
cmd_nohere="$cmdf"
_hdw0="$(printf '%s' "$cmdf" | grep -oE "<<-?'?[A-Za-z_][A-Za-z0-9_]*'?" | head -1 | sed -E "s/^<<-?'?//; s/'$//")"
if [ -n "$_hdw0" ]; then
  # Does the command OWNING the heredoc read it as a program? Tested on the text before the `<<`,
  # which is where the interpreter is named. If so the body is CODE and every rule keeps it raw.
  _pre0="$(printf '%s' "$cmdf" | sed -E "s/<<-?'?[A-Za-z_].*//")"
  if printf '%s' "$_pre0" | grep -qE '(^|[;&|[:space:]])(bash|sh|zsh|python3?|node|perl|ruby|php)([[:space:]]|$)'; then
    : # interpreter heredoc — the body is the program, so it stays visible to every rule
  # ⚠ AND THE STRIP FAILS CLOSED, reusing the rule the rebase-guard learned the hard way: `.*` is
  #   greedy and newlines are folded, so a terminator word appearing a SECOND time as a standalone
  #   token lets the strip swallow real commands after the heredoc (measured 2026-08-05: a body
  #   ending `A`, then a real `git checkout origin/main -- oxydex-dsp.js`, then a stray `A` — the
  #   checkout was stripped and the rule passed). POSIX sed has no lazy quantifier, so strip only
  #   when the terminator appears EXACTLY ONCE standalone; anything else keeps the full text.
  elif [ "$(printf '%s' "$cmdf" | grep -oE "(^|[[:space:]])$_hdw0([[:space:]]|$)" | wc -l)" -eq 1 ]; then
    cmd_nohere="$(printf '%s' "$cmdf" | sed -E "s/<<-?'?([A-Za-z_][A-Za-z0-9_]*)'?.*[[:space:]]\\1([[:space:]]|$)/ /g")"
  fi
fi

looks_like_write() {
  # A RUN OF ≥3 '>' IS A CONFLICT MARKER, NOT A REDIRECT — strip those runs before the redirect
  # test. Measured 2026-09-02: `grep -n "<<<<<<<\|=======\|>>>>>>>" briefs/X.md`, i.e. the standard
  # way to find conflict hunks after a rebase, matched `>` followed by a guarded path and was denied
  # as a write. That is a READ, and it is the read a session performs while doing the very thing this
  # guard asks for (rebase onto the upstream edits). No shell redirect uses three '>' — `>` and `>>`
  # are the whole vocabulary — so removing longer runs cannot hide a real write.
  local probe
  probe="$(printf '%s' "$1" | sed 's/>\{3,\}//g')"
  printf '%s' "$probe" | grep -qE "(>>?|\btee\b|\bcp\b|\bmv\b|\btruncate\b)[^|;&]*${GUARDED_RE}" && return 0
  printf '%s' "$1" | grep -qE '\bsed\b[^|;&]*(-[A-Za-z]*i\b|--in-place)' && return 0
  if printf '%s' "$1" | grep -qE '\b(python3?|node|perl|ruby|php)\b'; then
    # The path is usually behind a variable here, so no adjacency test can see it — the
    # write VERB is the only available signal.
    printf '%s' "$1" | grep -qE "(open\([^)]*['\"]w|\.write\(|writeFileSync|writeFile\(|>>?[[:space:]]*['\"]?briefs/)" && return 0
  fi
  return 1
}

cands=""
if [ -n "$f" ]; then
  rel="${f#"$root"/}"
  case "$rel" in
    briefs/*.md | DOCS-INDEX.md) cands="$rel" ;;
    *) : ;;
  esac
elif looks_like_write "$cmd_nohere"; then
  cands="$(printf '%s' "$cmd_nohere" | grep -oE "$GUARDED_RE" | sort -u)"
fi
[ -z "$cands" ] && exit 0

G rev-parse --verify -q HEAD >/dev/null 2>&1 || exit 0
G rev-parse --verify -q origin/main >/dev/null 2>&1 || exit 0
base="$(G merge-base HEAD origin/main 2>/dev/null)" || exit 0
# ── MID-MERGE, HEAD IS THE PRE-MERGE COMMIT AND THE TREE IS NOT ────────────────────────────────
#    A session that is DOING what this guard asks — merging the upstream edits in — has `MERGE_HEAD`
#    set, the upstream text already in its working tree, and a HEAD that still predates all of it.
#    Measured against HEAD alone, every upstream commit reads as "one you do not have", so the guard
#    denies the resolution edit and points at commits the author is looking at. Measured 2026-09-23
#    with both controls: DENY before the merge (correct), DENY mid-merge (this false positive),
#    allow after the merge commit (correct).
#
#    A false positive here is not merely noise: this hook's only way out is an escape hatch, and a
#    guard whose hatch becomes reflex is the guard that fails the day it is right. So the "commits
#    you do not have" set excludes anything already reachable from the merge in progress. Nothing
#    else is relaxed — a genuinely stale branch still denies, because `MERGE_HEAD` is absent there.
#    `CHERRY_PICK_HEAD` is covered for the same reason and on its own measurement, not by analogy:
#    a conflicted cherry-pick of an upstream commit reads DENY before this change and allow after,
#    with the stale control still denying.
#
#    ⚠ `REVERT_HEAD` is DELIBERATELY ABSENT, and it was in an earlier draft of this fix by derivation
#    ("the commit is in the tree before it is in HEAD") until a peer asked which of the three had
#    actually been measured. Measuring it removed it: you revert a commit you ALREADY HAVE, so
#    `REVERT_HEAD` is an ancestor of HEAD and excluding it changes nothing — and in the one case
#    where it would not be an ancestor (reverting a commit this branch lacks), the tree carries the
#    NEGATION of the upstream edit rather than the edit, so suppressing the denial would be wrong.
#    An unmeasured ref that is either a no-op or a false allow is not defence in depth.
_gitdir="$(G rev-parse --git-dir 2>/dev/null)"
_have_too=""
if [ -n "$_gitdir" ]; then
  case "$_gitdir" in /*) : ;; *) _gitdir="$root/$_gitdir" ;; esac
  for _p in MERGE_HEAD CHERRY_PICK_HEAD; do
    [ -f "$_gitdir/$_p" ] || continue
    while read -r _sha _rest; do
      [ -n "$_sha" ] && _have_too="$_have_too --not $_sha"
    done < "$_gitdir/$_p"
  done
fi
[ -z "$base" ] && exit 0

# Commits on origin/main touching EACH candidate that your branch does not have.
report=""; first=""; n=0
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  # shellcheck disable=SC2086 # $_have_too is a deliberately word-split "--not <sha>" list
  missed="$(G log --oneline --no-decorate "$base"..origin/main $_have_too -- "$rel" 2>/dev/null)" || continue
  [ -z "$missed" ] && continue
  [ -z "$first" ] && first="$rel"
  n=$((n + $(printf '%s\n' "$missed" | grep -c .)))
  report="$report
  $rel
$(printf '%s\n' "$missed" | sed 's/^/    /')"
done <<EOF
$cands
EOF
[ -z "$first" ] && exit 0

cat >&2 <<EOF
BLOCKED: a guarded doc has moved on origin/main since your branch's base — $n commit(s) you do not have.
$report

Editing it now is how a written answer disappears. On 2026-08-08 exactly this dropped a
concurrent session's §2 from GENERATOR-FOLLOWUPS-III: no hunks overlapped, so git raised
no conflict, the squash took the newer text, and the brief was left contradicting its own
§4 for two commits. Nothing in CI could have caught it.

${cd_missing:+
⚠ THIS BASE IS THE SHARED ROOT'S, NOT YOUR BRANCH'S. The command names \`cd $cd_missing\`, which does
  not exist yet — it is created by this same command — so there was no tree to measure and the base
  fell back to the checkout this hook runs in. If that worktree is current, these commits are ones
  you already have and this denial is spurious. CREATE THE WORKTREE IN ITS OWN CALL FIRST, then edit
  from it, and the guard measures your branch instead.
}
MEASURED AGAINST: $base_dir_label ($behind_label)

READ those commits first — they may already answer what you are about to write:

    git log -p $base..origin/main -- '$first'

Then rebase so your edit lands ON TOP of them rather than instead of them:

    node tools/rebase-safe.mjs

If you have read them and are deliberately writing over them, say so:

    CLAUDE_ALLOW_STALE_BRIEF=1 <your bash command>      (command position — the prefix is read
                                                         from the command text)
    export CLAUDE_ALLOW_STALE_BRIEF=1                   (REQUIRED for an Edit/Write: that path
                                                         carries no command text, so the variable
                                                         must already be in this hook's own
                                                         environment. An inline prefix cannot
                                                         reach it.)

(This reads your LOCAL origin/main and never fetches, so it can only UNDER-report.
 \`git fetch origin main\` first if it matters.)
EOF
exit 2
