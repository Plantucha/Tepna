#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-shared-tree.sh — PreToolUse(Bash) guard for a repo worked by SEVERAL agent
# sessions at once.
#
# This checkout is routinely shared. Files you did not create are routinely in the
# tree. Two classes of git command are therefore unsafe here, and both have already
# caused real damage:
#
#   BLANKET STAGING  git add -A / git add . / git commit -a
#     Sweeps whatever a concurrent session has in flight into YOUR commit, published
#     under YOUR message. Happened: commit cabd7f7 ("fix(ppgdex): …") also carries an
#     unrelated CPAP brief, its DOCS-INDEX row, and a ledger regen.
#
#   TREE DESTRUCTION  git reset --hard / git checkout . / git restore . /
#                     git stash / git clean -f
#     Discards uncommitted work that may be another session's ONLY copy. Nearly
#     happened: a session tried to reset this tree while another's unbacked-up clock
#     fix was sitting in it.
#
# Denies with an explanation so the agent adjusts rather than retries.
# Read-only forms (git stash list/show) are allowed.
#
# Escape hatch: CLAUDE_ALLOW_BLANKET_GIT=1 (set it deliberately, when you know the
# tree is yours alone).
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

[ "${CLAUDE_ALLOW_BLANKET_GIT:-}" = "1" ] && exit 0

cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
[ -z "$cmd" ] && exit 0

cmdn="${cmd//\\$'\n'/ }"; cmdn="${cmdn//$'\n'/ }"      # fold continuations + newlines
cmd_noquotes="$(sed "s/'[^']*'/''/g; s/\"[^\"]*\"/\"\"/g" <<<"$cmdn")"
# …AND STRIP HEREDOC BODIES TOO. The quote-stripping above exists because a commit MESSAGE may
# legitimately contain `-a`. But the long messages written in this repo arrive by HEREDOC
# (`git commit -F - <<'MSG' … MSG`), which is not quoted — so a message that merely mentions
# `git commit -a`, as one documenting THIS FILE must, was denied. Same intent, one more delimiter.
# Measured 2026-08-05: it blocked the commit shipping the rebase-guard rule.
cmd_noquotes="$(printf '%s' "$cmd_noquotes" | sed -E "s/<<-?'?([A-Za-z_][A-Za-z0-9_]*)'?.*[[:space:]]\1([[:space:]]|$)/ /g")"
GITX='(^|[^[:alnum:]_-])([^[:space:];&|]*/)?git([[:space:]]+(-[cC][[:space:]]*("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)|--git-dir=("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)|--work-tree=("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)|--exec-path=[^[:space:]]*|--no-pager))*[[:space:]]+'
QT='["'"'"']?'

# HOW A RULE IS MATCHED — read this before adding one.
#
# Rules match $cmdn: the RAW command with line-continuations and newlines folded to spaces. RAW,
# because a quote-stripped match cannot see `bash -c "git add -A"`. FOLDED, because grep is
# line-oriented, so `git add \<newline> -A` otherwise splits across two lines and matches nothing —
# that one defeats every rule in this file at once.
#
# The single exception is the `commit` rule, which matches $cmd_noquotes: a commit MESSAGE legitimately
# contains these strings ("fix -a flag parsing"), and there is no non-Bash path to a commit message,
# so a raw match there blocks documenting the very rules in this file. Stripping quotes for that ONE
# rule does not reopen `bash -c "..."`, because the add/reset/clean rules still match it raw.
#
# Every rule composes $GITX rather than spelling its own anchor. $GITX absorbs a path prefix
# (/usr/bin/git) and git's global options (-C <p>, -c k=v, --git-dir=). Those defeated six of the
# seven rules when each rule hand-rolled its anchor and only update-ref handled -C.
#
# KNOWN GAPS — this guard stops the accidental form, not a determined one. It cannot see through
# shell evaluation: `G=git; $G add -A`, `$(echo git) add -A`, `echo -A | xargs git add`, or a
# `-c alias.z=...` indirection. Do not describe it as complete.


deny() {
  jq -nc --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# `git update-ref refs/heads/X` — moving a ref that may be CHECKED OUT
#
# THE REF IS NOT THE TREE. `update-ref` is PLUMBING: it moves the ref and touches neither the
# working tree nor the index, and unlike every porcelain equivalent it performs NO worktree check.
# Compare, on a checked-out `main`:
#     git fetch origin main:main      -> "refusing to fetch into branch ... checked out at ..."
#     git branch -f main origin/main  -> "cannot force update the branch 'main' used by worktree ..."
#     git push . origin/main:main     -> refused
#     git update-ref refs/heads/main  -> SILENTLY SUCCEEDS
#
# 2026-08-03: a session ran it every iteration to "sync local main". Sound while main was not
# checked out; it later was, and nobody re-checked. HEAD then advanced while the tree stayed frozen,
# so every file a merged PR ADDED read as deleted. A subsequent `git add -A` staged 214 entries
# including 47 live-file deletions — 25 of them changesets, which would have silently dropped ~20
# parallel work-units from the next changelog. The count GREW with every merge instead of converging.
#
# The check that hid it: `git rev-list --count HEAD..origin/main` returned 0. The ref WAS synced.
_RE2="$GITX"'(update-ref([[:space:]]+--stdin|[[:space:]]+(-d[[:space:]]+|--no-deref[[:space:]]+)*'"$QT"'refs/heads/)|branch[[:space:]]+([^;&|]*[[:space:]])?(-f\b|--force\b)|push[[:space:]]+\.([[:space:]]|$)|symbolic-ref[[:space:]]+HEAD)'
if grep -qE "$_RE2" <<<"$cmdn"; then
  deny "BLOCKED: 'git update-ref refs/heads/...' in a shared checkout.

THE REF IS NOT THE TREE. update-ref is plumbing — it moves the ref and touches neither the working tree nor the index, and it is the ONLY form that skips git's checked-out-branch check. Every porcelain equivalent already refuses by name:

    git fetch origin main:main      refusing to fetch into branch ... checked out at ...
    git branch -f main origin/main  cannot force update the branch 'main' used by worktree ...

If the branch is checked out anywhere, moving its ref silently desynchronises that tree: files a merged PR ADDED then read as DELETED, and the next blanket add stages them for removal. That happened on 2026-08-03 — 47 live files, 25 of them changesets.

Instead, use the porcelain and let it refuse:
    git fetch origin main:main          # fails loudly if main is checked out
    # or work in your own worktree off origin/main and never touch local main at all

And to CHECK a tree is in sync, use 'git status --porcelain' (the tree), not 'git rev-list --count HEAD..origin/main' (the ref). The ref comparison returned 0 the whole time."
fi

# `git add -A` / `--all` / `.` / `:/`  — blanket staging
# `git add *` was allowed (adversarial pass 2026-08-05). Both spellings are blanket staging:
#   git add *     the SHELL expands it to every top-level entry
#   git add '*'   git's OWN pathspec glob, which matches every file RECURSIVELY — strictly worse
# Same damage as `-A`: it sweeps a concurrent session's in-flight files into your commit under your
# message. `git add ./*` is the same thing with a prefix.
_RE="$GITX"'add[[:space:]]+([^;&|]*[[:space:]])?(-A\b|--all\b|-u\b|--update\b|\.([[:space:]]|$)|:/|'"$QT"'(\./)?\*'"$QT"'([[:space:]]|$))'

# ── THE ONE BLANKET ADD THAT TOUCHES NOTHING: a TEMP-INDEX snapshot ──────────────────────────────
# CLAUDE.md §👥.2's own rescue recipe is `GIT_INDEX_FILE=/tmp/r.idx sh -c 'git add -A; git write-tree'`
# — the documented way to PRESERVE another session's uncommitted work without touching their tree.
# This guard denied it on the command text, so the procedure for rescuing work was itself
# unexecutable, and the documented escape hatch is for "when the tree is genuinely yours alone",
# which is precisely when a rescue is NOT needed. Measured 2026-08-16: a peer session could snapshot
# one file by explicit path but could not snapshot the 188-file shared tree at all.
#
# A blanket add into a SEPARATE index writes to a throwaway file. It touches no working-tree file and
# not the repo's index, so none of the damage this rule exists to prevent is reachable.
#
# DELIBERATELY NARROW. The exemption requires GIT_INDEX_FILE to name something that is NOT the repo's
# own index, so `GIT_INDEX_FILE=.git/index git add -A` stays DENIED — that is ordinary blanket
# staging wearing the recipe's clothes. `git commit -a` is not exempted at all: it commits.
_TEMPIDX=0
if grep -qE 'GIT_INDEX_FILE=[^[:space:];&|]+' <<<"$cmdn" \
   && ! grep -qE 'GIT_INDEX_FILE=[^[:space:];&|]*\.git/index' <<<"$cmdn"; then
  _TEMPIDX=1
fi

if [ "$_TEMPIDX" != 1 ] && grep -qE "$_RE" <<<"$cmdn"; then
  deny "BLOCKED: blanket staging in a SHARED checkout (CONTRIBUTING §6).

Several agent sessions work this repo at once, so the working tree is not yours alone — a blanket add sweeps their in-flight files into your commit, under your message. That is exactly how cabd7f7 ended up carrying an unrelated brief.

Instead: stage by EXPLICIT PATH —
    git add path/to/file-you-actually-changed.js ...
Run 'git status' first; if files you don't recognize are there, LEAVE them.

Better still: work in your own worktree, where this cannot arise —
    git worktree add ../wt-<task> -b claude/<task> origin/main"
fi

# `git commit -a` / `-am` / `--all`  — blanket staging via commit.
# Test against a QUOTE-STRIPPED copy: a commit MESSAGE may legitimately contain "-a"
# (e.g. git commit -m 'fix -a flag parsing') and must not be mistaken for the flag.
# Only this rule strips quotes (see the header block) — `git add "."` must still be caught by the rule above.
if grep -qE "$GITX"'commit\b[^;&|]*([[:space:]]-[a-zA-Z]*a[a-zA-Z]*\b|[[:space:]]--all\b)' <<<"$cmd_noquotes"; then
  deny "BLOCKED: 'git commit -a' stages every tracked modification in a SHARED checkout (CONTRIBUTING §6) — including other sessions' in-flight edits.

Instead: 'git add <explicit paths>' then a bare 'git commit'."
fi

# `git reset --hard` — destroys uncommitted work
if grep -qE "$GITX"'reset\b[^;&|]*(--hard|--keep)\b' <<<"$cmdn"; then
  deny "BLOCKED: 'git reset --hard' discards uncommitted work in a SHARED checkout — which may be another session's ONLY copy.

If you must reset, FIRST preserve what is there (this does not touch the tree):
    TREE=\$(GIT_INDEX_FILE=/tmp/rescue.idx sh -c 'cp .git/index /tmp/rescue.idx; git add -A; git write-tree')
    git branch rescue/\$(date +%F)-wip \$(git commit-tree \$TREE -p HEAD -m 'rescue: WIP snapshot')
…then ask the user before discarding anything you did not write."
fi

# `git checkout <ref> -- <SOURCE path>` — the mid-rebase conflict "shortcut" that silently reverts work
#
# Nearly every PR here must rebase, because `main` moves during review and the two orchestrator
# bundles are re-bundled by ANY change to ANY inlined module — so PRs that share no source at all
# still collide in them. The obvious shortcut is fatal:
#
#     git checkout origin/main -- $(git diff --name-only --diff-filter=U)
#
# It is CORRECT for a generated artifact (whose content is a function of source — neither side is
# authoritative, so you take either and rebuild) and DESTRUCTIVE for a source file, and it fails
# SILENTLY: the rebase completes, the tree is clean, the branch pushes, and the commit message still
# describes changes that are no longer in it. Measured 2026-08-05: one such line reverted a test
# group, a DSP fix and a provenance entry out of a single commit. Only
# `git show HEAD:<file> | grep` caught it.
#
# ⚠ The ref separator must accept `=` as well as whitespace. `git restore --source=origin/main -- x.js`
# is the SAME operation as the space form and BYPASSED the first version of this rule, which looked
# for a ref only after whitespace. Found by an adversarial pass, not by review — the space form was
# the one anybody would think to test.
#
# This rule fires only when the path list contains something OUTSIDE the generated set — a bundle,
# docs/, provenance/ are all fine and pass through. It deliberately does NOT try to enumerate the
# generated set in bash: `tools/rebase-safe.mjs` reads it from the builders that own it, and this
# guard just refuses the hand-rolled form and points there.
# HEREDOC BODIES ARE TEXT, NOT COMMANDS. This rule matches a command SHAPE that people also need to
# WRITE ABOUT — a changeset, a brief, this file. Dogfooding it blocked the very `git add` that was
# committing the rule, because the staged changeset described the bypass it fixes. `$cmd_noquotes`
# does not help: a heredoc body is not quoted. So this rule alone also tests a copy with `<<'W' … W`
# bodies removed. Same tradeoff, and same reason, as the quote-stripping on `git commit -a` above.
# THE STRIP MUST FAIL CLOSED. `.*` is greedy and newlines are folded, so a terminator word appearing
# a SECOND time as a standalone token lets the strip swallow real commands after the heredoc —
# measured: a body ending `A`, a real `git checkout origin/main -- oxydex-dsp.js`, then a stray `A`,
# and the checkout was stripped and the rule passed. POSIX sed has no lazy quantifier, so instead:
# strip only when the terminator appears EXACTLY ONCE standalone (the closer; the opener `<<'W'` is
# quoted and does not count). Anything else keeps the full text and the rule runs on it.
_hdw="$(printf '%s' "$cmdn" | grep -oE "<<-?'?[A-Za-z_][A-Za-z0-9_]*'?" | head -1 | sed -E "s/^<<-?'?//; s/'$//")"
cmd_nohd="$cmdn"
if [ -n "$_hdw" ] && [ "$(printf '%s' "$cmdn" | grep -oE "(^|[[:space:]])$_hdw([[:space:]]|$)" | wc -l)" -eq 1 ]; then
  cmd_nohd="$(printf '%s' "$cmdn" | sed -E "s/<<-?'?([A-Za-z_][A-Za-z0-9_]*)'?.*[[:space:]]\\1([[:space:]]|$)/ /g")"
fi
# THE SOURCE PATHS ARE EXTRACTED, NOT INFERRED FROM THE WHOLE COMMAND. Three holes in the first
# version, all found by an adversarial pass 2026-08-05, all of the accidental kind this guard exists
# to stop:
#   1. THE EXTENSION LIST OMITTED `.py`/`.sh`. Every line of `capture-host/` is Python and its deploy
#      scripts are shell, so the single largest body of source in this repo was uncovered.
#   2. THE PATH HAD TO END IN WHITESPACE OR EOL, so `-- "clock.js"` — a quoted path, which is how
#      anyone writes one containing a space, and this repo ships "Data Unifier.html" — slipped past.
#   3. THE docs//provenance/ EXEMPTION WAS COMMAND-WIDE. One generated path anywhere in the argument
#      list disabled the rule for the SOURCE files beside it. That is not a corner: a real conflict
#      list mixes the two, which is the whole reason this rule exists.
# So: pull out every token that LOOKS like a source path, drop the ones that are generated, and fire
# only if something is left. Wrong in the safe direction — an unrecognised extension is simply not
# matched, it never suppresses a match elsewhere.
#   4. THE PATHS WERE READ FROM THE WHOLE COMMAND, not from the checkout's own segment, so any
#      unrelated `.txt`/`.sh` mentioned in a `&&`-joined step supplied the "source path" for a
#      checkout that never touched one. This over-blocks (safe direction) but it fires on ordinary
#      compound commands — it blocked three consecutive attempts to run this rule's OWN test harness.
#      Paths now come from the checkout/restore segment only.
_ckseg="$(grep -oE "$GITX"'(checkout|restore)[^;&|]*' <<<"$cmd_nohd" || true)"
# A TRAVERSING PATH MUST NOT INHERIT THE PREFIX EXEMPTION. `provenance/../oxydex-dsp.js` matches
# `^provenance/` and was filtered OUT of the source list, so the rule stayed silent on a path that
# resolves to a root source file. tools/rebase-safe.mjs fixed this in the CLASSIFIER (#990); the hook
# kept the walkable prefix test. Anything containing `..` is kept as source regardless of its prefix —
# git never emits such a path from --diff-filter=U, so this only ever over-flags a hand-written one.
#   5. `docs/` IS NOT WHOLESALE GENERATED, and the hook and the classifier disagreed about it.
#      `build-docs.mjs` owns the SERVED copies under docs/ — a root page synced down, an asset
#      byte-copied, the six site artifacts it names — but docs/ ALSO holds 28 AUTHORED specs no builder
#      writes: docs/LEXICON.md, docs/EVENT-LEXICON.md, docs/EXPORT-SHAPES.md, all of docs/COMPLIANCE/.
#      #990 fixed exactly this in the CLASSIFIER, so `rebase-safe.mjs --classify docs/LEXICON.md` says
#      SOURCE — while this hook still waved through the hand-rolled checkout that reverts it. A guard
#      and the tool it points at must not disagree about the same path. `docs/**.md` is therefore kept
#      as source; every other docs/ path stays exempt, because those really are rebuildable.
#   6. AUTHORED `*.html` WAS INVISIBLE. The list carried `src.html` but not `html`, so `Science.html`,
#      `index.html` and every `* Reference.html` — all hand-written — could be reverted silently. This
#      is the mirror of the glob rebase-safe.mjs's own docstring refuses to use, for the same reason.
#      The bundles ARE rebuildable, so they stay exempt by name. That list is a deliberate exception to
#      "never enumerate the generated set in bash", and it is safe BECAUSE it is an allow-list: if a
#      bundle is added to the fleet and not added here, the guard merely over-denies and points at
#      `npm run rebase`, which is the correct answer for a bundle conflict anyway.
# ⚠ 6. A BARE DIRECTORY HAS NO EXTENSION, AND THE WIDER OPERATION WAS THE UNGUARDED ONE (2026-09-03).
#      The extraction below keys on a FILE EXTENSION, so `-- briefs/X-BRIEF.md` denied while
#      `-- briefs` — which restores every file in the directory, including every other session's
#      in-flight brief — was waved through. The narrow operation was blocked and the wide one allowed.
#      Measured after a session ran exactly that in the shared root and staged 78 briefs into the
#      root's index; no content was lost, but only because nobody had edits in flight at that minute.
#      So directory tokens after `--` are collected too, and treated as SOURCE unconditionally: a
#      directory is never wholesale-generated here (even `docs/` holds 28 authored specs, which is why
#      the awk below already prints `docs/*.md`), and over-denying points at `npm run rebase`, which is
#      the right answer for a real conflict anyway. `provenance` is the one arguable case and is NOT
#      exempted — restoring it wholesale discards `verifiedUnder` stamps that only a corpus run can
#      re-earn, which is a worse loss than a rebuild.
# ⚠ SCOPED TO THE `--` SEPARATOR, and that scoping is load-bearing. Without it the first version of
#   this extraction tokenised the WHOLE segment, so `git checkout -b claude/x origin/main` — creating a
#   branch, the most ordinary command in this repo — read `claude/x` and `origin/main` as directory
#   paths and was DENIED. The token must also START path-shaped: a QUOTED path containing a space
#   (`-- "Data Unifier.html"`) tokenises to `"Data`, which has no extension and would otherwise read as
#   a directory — the same quoted-path case the awk below already handles at its tail. Caught by the harness's MUST-ALLOW half, which is the half that stops a guard
#   becoming something people route around. The destructive form always names its paths after `--`.
_dirpaths=""
case "$_ckseg" in
  *" -- "*) _dirpaths="$(sed -E 's/.*[[:space:]]--[[:space:]]+//' <<<"$_ckseg" \
      | tr ' \t' '\n\n' \
      | grep -E '^[A-Za-z0-9._/][^[:space:];&|"'"'"']*$' \
      | grep -vE '\.[A-Za-z0-9]+$' || true)" ;;
esac
_srcpaths="$( { grep -oE '[^[:space:];&|"'"'"']+\.(js|mjs|py|sh|md|json|css|toml|ya?ml|txt|cff|html)' <<<"$_ckseg" || true; printf '%s\n' "$_dirpaths"; } \
  | grep -v '^$' \
  | awk '
      /\.\./                                   { print; next }   # traversal never inherits an exemption
      /^(\.\/)?docs\/.*\.md$/                  { print; next }   # AUTHORED spec under docs/ (see 5)
      /^(\.\/)?(docs|provenance)\//            { next }          # served copy / ledger fragment
      /^(\.\/)?(ECGDex|OxyDex|PulseDex|GlucoDex|PpgDex|HRVDex|CPAPDex|Integrator|MotionDex|OverDex)\.html$/ { next }
      /^(\.\/)?Unifier\.html$/                 { next }          # tail of the quoted "Data Unifier.html"
                                               { print }
    ' || true)"

# UNKNOWABLE PATHS MUST FAIL CLOSED. The extraction above needs a path token to be VISIBLE — so the
# canonical form, the one CLAUDE.md §2c prints and the one that did the damage,
#     git checkout origin/main -- $(git diff --name-only --diff-filter=U)
# names no path at all and this rule stayed silent on its own worked example. Measured against main
# 2026-08-05: ALLOWED, along with the backtick and `| xargs` spellings. A command substitution means
# the path list is not knowable statically, and `tools/rebase-safe.mjs` already settles that exact
# ambiguity the only safe way — unknown classifies as SOURCE. This guard now agrees with the tool it
# points at, instead of being strictest about the spellings nobody uses.
_ckdyn=''
grep -qE "$GITX"'(checkout|restore)[^;&|]*(\$\(|`)' <<<"$cmd_nohd" && _ckdyn=1
grep -qE 'xargs([[:space:]]+-[^[:space:]]+)*[[:space:]]+(git[[:space:]]+)?(checkout|restore)([[:space:]]|$)' <<<"$cmd_nohd" && _ckdyn=1

# `--ours` / `--theirs` NAME NO REF, so the ref clause never fired for them — yet taking one side
# wholesale IS the destructive operation this rule exists to refuse, and for tests/dex-tests.js it is
# exactly the wrong answer (restore main's copy, then RE-RUN your insertion). The ref clause was
# written from the shape of the command that caused the incident rather than from the operation.
_ckside=''
grep -qE "$GITX"'(checkout|restore)[^;&|]*--(ours|theirs)([[:space:]]|$)' <<<"$cmd_nohd" && _ckside=1

if [ -n "$_ckdyn" ] || { [ -n "$_srcpaths" ] && grep -qE "$GITX"'(checkout|restore)([[:space:]]|$)' <<<"$cmd_nohd" && { [ -n "$_ckside" ] || { grep -qE "$GITX"'(checkout|restore)[[:space:]]+([^;&|]*[[:space:]=])?(origin/|HEAD|[0-9a-f]{7,40})' <<<"$cmd_nohd" || grep -qE "$GITX"'(checkout|restore)[[:space:]]+([^;&|]*[[:space:]])?(--source[= ][^[:space:]]+|[^-][^[:space:];&|]*[[:space:]]+--[[:space:]])' <<<"$cmd_nohd"; }; }; }; then
  deny "BLOCKED: 'git checkout <ref> -- <source path>' in a shared checkout.

This is the mid-rebase conflict shortcut, and it is the one that fails SILENTLY. It is correct for a
GENERATED artifact — a bundle, docs/, provenance/ — whose content is a function of source, so neither
side of the conflict is authoritative and the answer is to take either and REBUILD. It is DESTRUCTIVE
for a source file: the rebase finishes, the tree is clean, the push succeeds, and your commit message
still describes changes that are no longer in the commit. Measured 2026-08-05 — one such line dropped
a test group, a DSP fix and a provenance entry at once.

Use the tool that knows the difference (it asks the BUILDERS which paths they own, so it cannot
guess wrong, and it fails CLOSED if it cannot tell):

    node tools/rebase-safe.mjs

It auto-resolves generated conflicts, rebuilds every generated tree, and STOPS on a source conflict
instead of picking a side. For tests/dex-tests.js specifically: restore main's copy and RE-RUN your
insertion — never keep one side wholesale.

If you really are restoring one file deliberately (e.g. reverting your own edit), run it on that one
explicit path outside a rebase, and VERIFY afterwards:
    git show HEAD:<file> | grep -c <an identifier your change adds>"
fi

# `git checkout .` / `git checkout -- .` / `git restore .` — discards working-tree changes
if grep -qE "$GITX"'(checkout[[:space:]]+([^;&|]*[[:space:]])?(-f\b|--force\b)|(checkout|restore)[[:space:]]+([^;&|]*[[:space:]])?(--[[:space:]]+)?(\.([[:space:]]|$)|:/))' <<<"$cmdn"; then
  deny "BLOCKED: discarding ALL working-tree changes in a SHARED checkout — they may be another session's only copy.

Restore only the paths you own:
    git checkout -- path/you/changed.js"
fi

# `git stash` (mutating forms) — hides another session's work out from under it
if grep -qE "$GITX"'stash([[:space:]]|$)' <<<"$cmdn" \
   && grep -oE "$GITX"'stash([[:space:]]+[^[:space:];&|]+)?' <<<"$cmdn" \
      | grep -qvE 'stash[[:space:]]+(list|show)$'; then
  deny "BLOCKED: 'git stash' in a SHARED checkout would sweep another session's uncommitted work into your stash — invisible to them, and easy to lose.

If you need a clean tree, use your OWN worktree instead:
    git worktree add ../wt-<task> -b claude/<task> origin/main
('git stash list' / 'git stash show' are allowed.)"
fi

# `git clean -f` — deletes untracked files (another session's new files)
if grep -qE "$GITX"'clean\b[^;&|]*-[a-zA-Z]*f' <<<"$cmdn"; then
  deny "BLOCKED: 'git clean -f' DELETES untracked files — which in a shared checkout includes new files another session has not committed yet (briefs, changesets, fixtures).

Delete only what you created, by name."
fi


# `git rm -r --cached .` / `git rm -rf .` — blanket removal. Same damage class as blanket staging
# (it stages a deletion of everything, including files that are another session's only copy), and
# there was no rule for it at all.
if grep -qE "$GITX"'rm[[:space:]]+([^;&|]*[[:space:]])?(-[a-zA-Z]*r[a-zA-Z]*\b|--cached\b)[^;&|]*(\.([[:space:]]|$)|:/)' <<<"$cmdn"; then
  deny "BLOCKED: blanket 'git rm' in a SHARED checkout.

This stages a deletion of every matching file — including files another session created and has not
committed. Remove by EXPLICIT PATH instead: git rm path/to/file.

Escape hatch when the tree is genuinely yours alone: CLAUDE_ALLOW_BLANKET_GIT=1"
fi

# Flags whose ONLY purpose is to override a safety check that exists to protect UNCOMMITTED or
# UNMERGED work — i.e. exactly the other session's work this guard exists for. The unforced form of
# each is allowed, because git's own refusal is the protection.
#   git worktree remove --force   overrides "contains modified or untracked files"
#   git branch -D                 overrides "not fully merged"
# A reviewer of THIS PR had their worktree removed out from under them mid-session. That is the
# failure being prevented, observed, in this repo, today.
if grep -qE "$GITX"'worktree[[:space:]]+remove[[:space:]]+([^;&|]*[[:space:]])?(-f\b|--force\b)' <<<"$cmdn"; then
  deny "BLOCKED: 'git worktree remove --force' in a SHARED checkout.

--force exists to override git's refusal to remove a worktree holding modified or untracked files.
That refusal is the protection: those files may be another session's only copy.

Run it WITHOUT --force. If git refuses, that is the guard working — look at what is in there first.

Escape hatch when the tree is genuinely yours alone: CLAUDE_ALLOW_BLANKET_GIT=1"
fi

if grep -qE "$GITX"'branch[[:space:]]+([^;&|]*[[:space:]])?-D\b' <<<"$cmdn"; then
  deny "BLOCKED: 'git branch -D' in a SHARED checkout.

-D overrides git's refusal to delete a branch that is not fully merged — which is how another
session's unmerged work disappears. Use -d; if git refuses, the branch still holds unmerged commits.

Escape hatch when the tree is genuinely yours alone: CLAUDE_ALLOW_BLANKET_GIT=1"
fi


exit 0
