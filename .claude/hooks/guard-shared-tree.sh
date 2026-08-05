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
GITX='(^|[^[:alnum:]_-])([^[:space:];&|]*/)?git([[:space:]]+(-[cC][[:space:]]*("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)|--git-dir=("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)|--work-tree=("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)|--exec-path=[^[:space:]]*|--no-pager|-P\b|--no-optional-locks\b|--literal-pathspecs\b|--noglob-pathspecs\b|--icase-pathspecs\b|--no-replace-objects\b))*[[:space:]]+'
QT='["'"'"']?'
# NB on the global-option list above: `-P` is the SHORT form of `--no-pager`, which was already here —
# so `git -P add -A` walked past every rule while `git --no-pager add -A` was caught. Same for the
# pathspec-mode flags an IDE or wrapper puts there. A global option git accepts before the subcommand
# and this list does not know is a bypass of the WHOLE file, not of one rule (adversarial pass III).

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
_RE2="$GITX"'(update-ref([[:space:]]+--stdin|[[:space:]]+(-d[[:space:]]+|--no-deref[[:space:]]+)*'"$QT"'refs/heads/)|branch[[:space:]]+([^;&|]*[[:space:]])?(-f\b|--force\b)|push[[:space:]]+([^;&|]*[[:space:]])?\.([[:space:]]|$)|symbolic-ref[[:space:]]+HEAD)'
# NB `push[[:space:]]+\.` required the dot to sit IMMEDIATELY after `push`, so `git push --force . HEAD:main`
# — verified here to move a branch ref — walked past the one rule written to stop ref moves (pass III).
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
#
# TWO BYPASSES FIXED IN ADVERSARIAL PASS III, both trivial to type by accident:
#
#  · BUNDLED SHORT FLAGS. `-A\b` has no word boundary between `A` and a following letter, so `git add
#    -Av` and `git add -An` matched nothing — while `git add -vA` was caught. git's parse-options
#    bundles short flags, and `git add -Av` was verified here to stage every modification AND every
#    untracked file. The sibling rules for `commit -a`, `clean -f` and `rm -r` all already spelled the
#    bundled form `-[a-zA-Z]*X[a-zA-Z]*`; `add` — the rule this file exists for — was the one that did not.
#
#  · THE QUOTED DOT. `git add "."` and `git add '.'` walked past, because the rules match the RAW
#    command (deliberately — see the header) and `."` is not `.` followed by whitespace. The header
#    block asserts «`git add "."` must still be caught by the rule above» as the stated reason the
#    commit rule may strip quotes and this one may not. That claim was false. Hence $QT on both sides.
_RE="$GITX"'add[[:space:]]+([^;&|]*[[:space:]])?(-[a-zA-Z]*[Au][a-zA-Z]*\b|--all\b|--update\b|'"$QT"'\.'"$QT"'([[:space:]]|$)|:/)'
if grep -qE "$_RE" <<<"$cmdn"; then
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
# ⚠ THE STRIP MUST FAIL CLOSED. `.*` is greedy and newlines are already folded, so a terminator word
# appearing a THIRD time lets the strip swallow real commands after the heredoc — measured: a body
# ending `A`, then a real `git checkout origin/main -- oxydex-dsp.js`, then a stray `A`, stripped the
# checkout and the rule passed. There is no lazy quantifier in POSIX sed, so instead: only strip when
# the terminator appears EXACTLY ONCE as a standalone word (the closer; the opener is `<<'W'`, quoted,
# so it does not count). Two standalone occurrences means the body itself contains the terminator word,
# and greedy `.*` then runs to the SECOND one — measured: a body ending `A`, a real
# `git checkout origin/main -- oxydex-dsp.js`, then a stray `A`, and the checkout was stripped away.
# Anything but exactly one keeps the full text and the rule runs on it — over-flagging a weird command,
# never under-flagging one.
cmd_nohd="$cmdn"
# NB: extract with sed, not `tr -d "<-'"` — in tr that is a RANGE ('<' 0x3C to "'" 0x27, reversed),
# not a set, so the terminator came back empty, the strip was skipped, and the rule false-positived on
# a heredoc merely DESCRIBING the pattern. Exactly the failure the strip exists to prevent.
_hdw="$(printf '%s' "$cmdn" | grep -oE "<<-?'?[A-Za-z_][A-Za-z0-9_]*'?" | head -1 | sed -E "s/^<<-?'?//; s/'$//")"
if [ -n "$_hdw" ] && [ "$(printf '%s' "$cmdn" | grep -oE "(^|[[:space:]])$_hdw([[:space:]]|$)" | wc -l)" -eq 1 ]; then
  cmd_nohd="$(printf '%s' "$cmdn" | sed -E "s/<<-?'?([A-Za-z_][A-Za-z0-9_]*)'?.*[[:space:]]\\1([[:space:]]|$)/ /g")"
fi
# THREE WIDENINGS, each from a working bypass (adversarial pass 2026-08-05, second round):
#
# 1 · THE GENERATED-PATH EXEMPTION WAS COMMAND-WIDE, NOT PER-PATH. `! grep provenance/|docs/` disarmed
#     the WHOLE rule the moment any token mentioned them — so
#         git checkout origin/main -- docs/PpgDex.html oxydex-dsp.js
#     passed, and that is not an exotic input: it IS the shape of a real conflict list here, because the
#     orchestrators, docs/ and provenance/ regenerate together with the source that moved them. The rule
#     was therefore disarmed in precisely the case it exists for. Bash cannot classify per path without
#     re-implementing the builders' ownership — which is the tool's job — so the exemption is GONE and
#     the rule now fires on any ref-checkout of a path list. A generated-only restore is over-flagged;
#     that is the correct direction, and `npm run rebase` does that restore for you anyway.
#     `provenance/../oxydex-dsp.js` also walked out of the prefix test; with no prefix test, it cannot.
#
# 2 · THE REF PATTERN ONLY KNEW `origin/`, `HEAD`, AND HEX. `git checkout main -- oxydex-dsp.js`,
#     `upstream/main`, `@{u}` and a tag all bypassed. A ref is now "a non-flag token before `--`", plus
#     the `--source=`/`--source ` forms, which is what the operation actually looks like.
#
# 3 · THE EXTENSION LIST OMITTED AUTHORED NON-JS SOURCE. `Science.html` and `OxyDex Reference.html` are
#     authored (a `*.html` glob is wrong for the opposite reason — the bundles are generated), and
#     `capture-host/*.py`, `.github/workflows/*.yml` and this hook itself are source too. The rule no
#     longer inspects extensions at all: a ref plus `--` plus a path is the destructive shape whatever
#     the suffix, and the tool is the thing that knows which side is authoritative.
#
# 4 · THE EXEMPTION IS NOW PER-PATH, AND ONLY FOR PREFIXES BASH CAN CHECK. The generated-only restore
#     stays allowed — it is correct and common — but EVERY path after `--` must be under `provenance/`,
#     the ONE tree whose generated-ness is a prefix rather than a lookup. A root bundle
#     (`OverDex.html`) is NOT exempted even though it is generated: distinguishing it from the authored
#     `Science.html` / `OxyDex Reference.html` needs the builders' list, which is exactly what this hook
#     must not guess — so it fails closed there and `npm run rebase` covers it. `..` anywhere in the
#     path list voids the exemption outright.
# 5 · THE EXEMPTION IS DECIDED PER COMMAND SEGMENT, NOT PER LINE (adversarial pass III). It read
#     `${cmd_nohd##* -- }` — the text after the LAST ` -- ` in the whole line — so a second, harmless
#     restore disarmed a destructive first one:
#         git checkout origin/main -- oxydex-dsp.js; git checkout origin/main -- docs/OxyDex.html
#     Both were verified to pass. Chaining two restores mid-rebase is ordinary, not exotic, and the
#     bypass grows the more of the conflict list you resolve. The same one-window read also
#     FALSE-POSITIVED in the other direction: `git checkout origin/main -- docs/a.html && npm run check`
#     swept `&& npm run check` into the path list and denied a correct, common command. Splitting on
#     `; && || |` first fixes both — each segment is judged on its own path list.
_refco=0
while IFS= read -r _seg; do
  [ -z "$_seg" ] && continue
  grep -qE "$GITX"'(checkout|restore)[[:space:]]+([^;&|]*[[:space:]])?(--source[= ][^[:space:]]+|[^-][^[:space:];&|]*[[:space:]]+--[[:space:]])' <<<"$_seg" || continue
  _allgen=0
  case "$_seg" in *" -- "*) _paths="${_seg##* -- }" ;; *) _paths="" ;; esac
  if [ -n "$_paths" ] && ! grep -q '\.\.' <<<"$_paths"; then
    _allgen=1
    for _t in $_paths; do
      case "$_t" in
        # `provenance/` ONLY. `docs/` is NOT a generated prefix: 30 authored .md live there
        # (docs/COMPLIANCE/*, EVENT-LEXICON.md, the specs) with no root twin and no builder — verified
        # 2026-08-05, and build-docs.mjs filters .md out of its asset list entirely, so a rebuild
        # cannot put one back. Exempting the prefix would let
        #     git checkout origin/main -- docs/EVENT-LEXICON.md
        # silently revert an authored spec: the same defect this rule exists to stop, relocated. The
        # served bundles under docs/ ARE generated, but the hook cannot tell which — that needs the
        # builder's own list, which is the tool's job — so it fails closed on all of docs/.
        provenance/*) ;;
        *) _allgen=0 ;;
      esac
    done
  fi
  [ "$_allgen" = "1" ] || _refco=1
done < <(printf '%s\n' "$cmd_nohd" | sed -E 's/[[:space:]]*(\|\||&&|;|&|\|)[[:space:]]*/\n/g')
if [ "$_refco" = "1" ]; then
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

# `git checkout .` / `git checkout -- .` / `git restore .` / `git switch -f` — discards working-tree changes
#
# `git switch` WAS NOT IN THIS FILE AT ALL (adversarial pass III). It is the modern half of the
# checkout split — `git switch -f <branch>` is `--discard-changes`, and it was verified here to
# silently destroy an uncommitted edit exactly as `git checkout -f` does. `checkout -f` was denied and
# `switch -f` was allowed, which is the worse of the two failures: the guard reads as covering the
# operation while covering only its older spelling. `restore` was already handled; `switch` completes
# the pair.  The dot alternatives also take $QT — `git checkout -- "."` had the same quoted-dot hole
# as `git add "."` above.
if grep -qE "$GITX"'(checkout[[:space:]]+([^;&|]*[[:space:]])?(-f\b|--force\b)|switch[[:space:]]+([^;&|]*[[:space:]])?(-f\b|--force\b|--discard-changes\b)|(checkout|restore)[[:space:]]+([^;&|]*[[:space:]])?(--[[:space:]]+)?('"$QT"'\.'"$QT"'([[:space:]]|$)|:/))' <<<"$cmdn"; then
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
