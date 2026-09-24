#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-stale-brief.test.sh — self-test for guard-stale-brief.sh.
#
# Builds a THROWAWAY repo with a real divergence (a brief advanced on `origin/main`
# that a branch does not have) and drives the hook exactly as the harness does: the
# tool-call JSON on stdin. A guard nobody has watched fail is not a guard — every
# DENY case below is paired with an ALLOW case that differs in ONE property, so a
# rule that fires on everything scores as loudly as one that fires on nothing.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-stale-brief.sh"
fail=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── a repo where origin/main has a brief commit the working branch lacks ────────
UP="$TMP/upstream"; WORK="$TMP/work"
git init -q --bare "$UP"
git clone -q "$UP" "$WORK" 2>/dev/null
cd "$WORK"
git config user.email t@t; git config user.name t
mkdir -p briefs tools
printf 'v1\n' > briefs/SHARED-BRIEF.md
printf 'v1\n' > briefs/OTHER-BRIEF.md
printf 'v1\n' > DOCS-INDEX.md
printf 'v1\n' > README.md
git add -A >/dev/null; git commit -qm base
git branch -M main; git push -q origin main 2>/dev/null

# my branch, based here
git checkout -qb mine
# …meanwhile main advances, touching ONLY SHARED-BRIEF.md + DOCS-INDEX.md
git checkout -q main
printf 'v2 — a concurrent session answered §2 here\n' > briefs/SHARED-BRIEF.md
printf 'v2\n' > DOCS-INDEX.md
# README + briefs/notes.txt + docs/briefs/x.md ALSO move, so the "not in the guarded set"
# ALLOWs below differ from the DENYs in the guarded-set membership ALONE. Without this the
# fixture is a tautology: every out-of-set file was also an unmoved file, and a mutant that
# dropped the set check entirely still scored green (measured — it survived M1).
printf 'v2\n' > README.md
mkdir -p docs/briefs
printf 'v2\n' > briefs/notes.txt
printf 'v2\n' > docs/briefs/x.md
git add -A >/dev/null
git commit -qm 'concurrent: answer §2'
git push -q origin main 2>/dev/null
git checkout -q mine
git fetch -q origin main 2>/dev/null

run() { # run <file_path> ; echoes DENY or ALLOW
  printf '{"tool_input":{"file_path":"%s"}}' "$1" | bash "$H" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
expect() { # expect <want> <label> <file>
  local got; got="$(run "$3")"
  if [ "$got" = "$1" ]; then printf '  ok    %-58s %s\n' "$2" "$got"
  else printf '  FAIL  %-58s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}

echo "### the divergence it exists to catch"
expect DENY  "brief advanced on origin/main, branch has not"        "briefs/SHARED-BRIEF.md"
expect DENY  "…absolute path resolves to the same rule"             "$WORK/briefs/SHARED-BRIEF.md"
expect DENY  "DOCS-INDEX.md is guarded for the same reason"         "DOCS-INDEX.md"

echo
echo "### the paired ALLOWs — each differs in exactly ONE property"
# same directory, same extension, same branch state — but NOT advanced upstream.
expect ALLOW "a brief that did NOT move upstream"                   "briefs/OTHER-BRIEF.md"
# advanced upstream, but not in the guarded set.
expect ALLOW "README moved upstream too — but is out of the set"    "README.md"
expect ALLOW "briefs/ non-markdown moved too — still not a brief"   "briefs/notes.txt"
expect ALLOW "docs/briefs/ moved too — 'briefs/' must ANCHOR"      "docs/briefs/x.md"

echo
echo "### §3 — a write that arrives through Bash (the matcher was a TOOL name, not a write)"
runcmd() { # runcmd <command string> ; echoes DENY or ALLOW
  jq -nc --arg c "$1" '{tool_input:{command:$c}}' | bash "$H" >/dev/null 2>&1
  [ $? -eq 2 ] && echo DENY || echo ALLOW
}
expectcmd() { # expectcmd <want> <label> <command>
  local got; got="$(runcmd "$3")"
  if [ "$got" = "$1" ]; then printf '  ok    %-58s %s\n' "$2" "$got"
  else printf '  FAIL  %-58s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}
# The four routes the brief's own author actually used, all previously unguarded.
expectcmd DENY  "cat > a stale brief"                               "cat > briefs/SHARED-BRIEF.md <<'X'
v3
X"
expectcmd DENY  "sed -i on a stale brief"                           "sed -i 's/a/b/' briefs/SHARED-BRIEF.md"
expectcmd DENY  "python heredoc — path behind a VARIABLE"           "python3 - <<'PY'
p='briefs/SHARED-BRIEF.md'
io.open(p,'w').write('v3')
PY"
expectcmd DENY  "DOCS-INDEX.md through a redirect"                  "printf 'v3' >> DOCS-INDEX.md"

# Paired ALLOWs. Each differs in ONE property from a DENY above, and the first two are the
# ones that matter: this hook's OWN remedy names a brief, so a guard that fired on reading
# would deny its own advice.
expectcmd ALLOW "the remedy this hook prints is a READ, not a write"  "git log -p HEAD..origin/main -- 'briefs/SHARED-BRIEF.md'"
expectcmd ALLOW "grep of a stale brief is not a write"                "grep -n 'v1' briefs/SHARED-BRIEF.md | head"
expectcmd ALLOW "write-shaped, but the brief did NOT move upstream"   "sed -i 's/a/b/' briefs/OTHER-BRIEF.md"
expectcmd ALLOW "write-shaped, but out of the guarded set"            "sed -i 's/a/b/' README.md"
expectcmd ALLOW "staging a stale brief is not writing it"             "git add briefs/SHARED-BRIEF.md"

# ── The two defects measured 2026-09-02, each negated by one leg ────────────────────────────
# (1) A RUN OF >=3 '>' IS A CONFLICT MARKER, NOT A REDIRECT. This exact command — the standard
#     way to find conflict hunks after a rebase — was DENIED as a write, while being a read, and
#     being the read a session performs while doing the rebase this guard asks for.
expectcmd ALLOW "conflict-marker grep is a READ, not a redirect"      "grep -n '<<<<<<<\\|=======\\|>>>>>>>' briefs/SHARED-BRIEF.md"
# The negation: two '>' is a real append and must still be caught, so the strip cannot be widened.
expectcmd DENY  "a real >> append is still a write"                   "printf 'v3' >> briefs/SHARED-BRIEF.md"

# (2) THE INLINE HATCH. The hook runs as a separate process BEFORE the command it gates, so an
#     inline prefix never reached the env check — while the denial text and CLAUDE.md advertised it.
expectcmd ALLOW "inline hatch in command position releases it"        "CLAUDE_ALLOW_STALE_BRIEF=1 sed -i 's/a/b/' briefs/SHARED-BRIEF.md"
# ⚠ The `cd` target must be the TEST REPO, not /tmp. A first draft used /tmp and passed against the
#   UNFIXED hook — the cd-extraction resolved a non-repo, the guard failed open, and the leg proved
#   nothing. It has to reach the staleness query to be testing command-position matching at all.
expectcmd ALLOW "inline hatch after && is command position too"       "cd $WORK && CLAUDE_ALLOW_STALE_BRIEF=1 sed -i 's/a/b/' briefs/SHARED-BRIEF.md"
# The negation, and the reason the match is anchored: merely NAMING the variable must not release
# the guard, or writing prose about the hatch would disable it.
expectcmd DENY  "the variable merely QUOTED does not release it"      "echo 'set CLAUDE_ALLOW_STALE_BRIEF=1 to override' >> briefs/SHARED-BRIEF.md"

echo
echo "### escape hatch + degenerate inputs"
got="$(printf '{"tool_input":{"file_path":"briefs/SHARED-BRIEF.md"}}' | CLAUDE_ALLOW_STALE_BRIEF=1 bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    CLAUDE_ALLOW_STALE_BRIEF=1 releases it"
else echo "  FAIL  escape hatch did not release"; fail=$((fail+1)); fi
expect ALLOW "no file_path in the payload"                          ""
got="$(printf 'not json' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    malformed payload fails OPEN, never blocks blindly"
else echo "  FAIL  malformed payload denied"; fail=$((fail+1)); fi

echo
echo "### fails OPEN outside a repo (a git hiccup must not block all doc edits)"
mkdir -p "$TMP/norepo/briefs"; printf 'x\n' > "$TMP/norepo/briefs/A.md"
got="$(cd "$TMP/norepo" && printf '{"tool_input":{"file_path":"briefs/A.md"}}' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    no git repo ⇒ ALLOW"
else echo "  FAIL  denied outside a repo"; fail=$((fail+1)); fi
# a repo with no origin/main at all
R2="$TMP/noremote"; mkdir -p "$R2/briefs"; (cd "$R2" && git init -q . && git config user.email t@t && git config user.name t && printf 'x\n' > briefs/A.md && git add -A >/dev/null && git commit -qm x)
got="$(cd "$R2" && printf '{"tool_input":{"file_path":"briefs/A.md"}}' | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW)"
if [ "$got" = ALLOW ]; then echo "  ok    no origin/main ⇒ ALLOW"
else echo "  FAIL  denied with no origin/main"; fail=$((fail+1)); fi

echo
echo "### the message names the commits (a bare refusal teaches nothing)"
msg="$(cd "$WORK" && printf '{"tool_input":{"file_path":"briefs/SHARED-BRIEF.md"}}' | bash "$H" 2>&1 >/dev/null)"
for want in "answer §2" "rebase-safe" "CLAUDE_ALLOW_STALE_BRIEF" "git log -p"; do
  if grep -qF -- "$want" <<<"$msg"; then echo "  ok    message carries '$want'"
  else echo "  FAIL  message missing '$want'"; fail=$((fail+1)); fi
done

echo
echo "### the WIRING — a hook that is not wired is inert, however green its behaviour reads"
# This is the §3 defect one level up: the guard was correct and simply never ran for Bash.
# Nothing else in the tree reads .claude/settings.json, so a silent unwiring — or a widened
# matcher quietly reverted — would leave every case above passing.
S="$(cd "$(dirname "$H")/.." && pwd)/settings.json"
if [ -f "$S" ]; then
  wired="$(jq -r --arg h guard-stale-brief.sh '
    [.hooks.PreToolUse[]? | select(any(.hooks[]?; .command | test($h))) | .matcher] | sort | join(",")
  ' "$S" 2>/dev/null)"
  case "$wired" in
    *"Edit|Write"*) echo "  ok    wired for Edit|Write" ;;
    *) echo "  FAIL  not wired for Edit|Write (matchers: '$wired')"; fail=$((fail+1)) ;;
  esac
  case "$wired" in
    *Bash*) echo "  ok    wired for Bash — §3, where computed edits arrive" ;;
    *) echo "  FAIL  not wired for Bash — a heredoc/sed -i/redirect write bypasses this guard"; fail=$((fail+1)) ;;
  esac
  # An `if:` clause on THIS entry would silently re-open §3 for every non-matching command.
  unconditional="$(jq -r --arg h guard-stale-brief.sh '
    [.hooks.PreToolUse[]? | select(.matcher | test("Bash")) | .hooks[]? | select(.command | test($h)) | (.["if"] // "none")] | join(",")
  ' "$S" 2>/dev/null)"
  if [ "$unconditional" = "none" ]; then echo "  ok    the Bash entry is unconditional (no 'if:' narrowing it)"
  else echo "  FAIL  the Bash entry carries if='$unconditional' — commands outside it bypass the guard"; fail=$((fail+1)); fi
else
  echo "  FAIL  .claude/settings.json not found at $S"; fail=$((fail+1))
fi

echo
echo "### THE TREE THE HOOK MEASURES — every case above runs with cwd INSIDE the repo under test,"
echo "### so hook-cwd and edit-target are the SAME tree by construction and cannot disagree."
# 0 That is why this file passed while the guard was a repo-wide no-op. CLAUDE.md mandates worktrees,
#   so the real deployment ALWAYS has hook-cwd (= $CLAUDE_PROJECT_DIR, the shared root) different from
#   the tree being edited. Two independent defects appear only when they differ:
#     - `root="$(git rev-parse --show-toplevel)"` resolves in the hook's cwd, so `rel="${f#"$root"/}"`
#       fails to strip a path from ANOTHER worktree; `cands` ends up empty and the hook ALLOWs.
#     - `base="$(git merge-base HEAD origin/main)"` likewise reads the hook's cwd HEAD, so staleness
#       is asked of the wrong tree entirely.
#   Measured 2026-08-18 on the live repo: with the root at origin/main the hook's own query returned
#   '' for DOCS-INDEX.md and for a brief that had moved within 20 commits. It allowed everything.
STALE="$TMP/stale-worktree"
CUR="$TMP/current-worktree"
git -C "$WORK" worktree add -q --detach "$STALE" mine 2>/dev/null
git -C "$WORK" worktree add -q --detach "$CUR" origin/main 2>/dev/null

run_from() { # run_from <cwd> <file_path>
  ( cd "$1" && printf '{"tool_input":{"file_path":"%s"}}' "$2" | bash "$H" >/dev/null 2>&1
    [ $? -eq 2 ] && echo DENY || echo ALLOW )
}
expect_from() { # expect_from <want> <label> <cwd> <file>
  local got; got="$(run_from "$3" "$4")"
  if [ "$got" = "$1" ]; then printf '  ok    %-58s %s\n' "$2" "$got"
  else printf '  FAIL  %-58s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}

# THE FALSE NEGATIVE - the dangerous direction. The EDITED tree is genuinely stale while the tree the
# hook happens to sit in is current. This is exactly the overwrite the guard exists to stop.
expect_from DENY  "STALE worktree edited while cwd-tree is CURRENT" "$CUR" "$STALE/briefs/SHARED-BRIEF.md"

# THE FALSE POSITIVE - the mirror, and the one that merely annoys: the edited tree already HAS the
# commit while the tree the hook sits in does not, so a block denies a perfectly safe edit.
expect_from ALLOW "CURRENT worktree edited while cwd-tree is STALE" "$STALE" "$CUR/briefs/SHARED-BRIEF.md"

# ANTI-VACUITY: the same two trees must still answer correctly when cwd IS the edited tree, so a
# "fix" that stopped resolving anything cannot pass by blanket-allowing or blanket-denying.
expect_from DENY  "...stale tree, cwd inside IT - still denied"     "$STALE" "$STALE/briefs/SHARED-BRIEF.md"
expect_from ALLOW "...current tree, cwd inside IT - still allowed"  "$CUR"   "$CUR/briefs/SHARED-BRIEF.md"

# ── THE BASH ROUTE'S TREE — the residual gap the hook's own header documented ──────────────────
# The file_path route resolves from the edited file; the Bash route carried no file, so it fell
# back to the hook's cwd (the shared root) and asked staleness of a tree the author was not
# editing. Measured 2026-08-20: three FALSE DENIALS in one session, each naming a commit the
# editing worktree already had. These are the same two directions as above, through `cd`.
runcmd_from() { # runcmd_from <cwd> <command>
  ( cd "$1" && jq -nc --arg c "$2" '{tool_input:{command:$c}}' | bash "$H" >/dev/null 2>&1
    [ $? -eq 2 ] && echo DENY || echo ALLOW )
}
expectcmd_from() { # expectcmd_from <want> <label> <cwd> <command>
  local got; got="$(runcmd_from "$3" "$4")"
  if [ "$got" = "$1" ]; then printf '  ok    %-58s %s\n' "$2" "$got"
  else printf '  FAIL  %-58s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi
}

# FALSE POSITIVE — the one measured in the wild. The `cd` names a CURRENT tree while the hook
# sits in a STALE one; without the cd-resolution this DENIES a perfectly safe edit.
expectcmd_from ALLOW "bash cd->CURRENT tree while cwd-tree is STALE" "$STALE" \
  "cd $CUR && python3 -c \"open('briefs/SHARED-BRIEF.md','w').write('v3')\""

# FALSE NEGATIVE — the dangerous mirror. The `cd` names a STALE tree while the hook sits in a
# CURRENT one, so cwd-fallback would ALLOW the overwrite this guard exists to stop.
expectcmd_from DENY  "bash cd->STALE tree while cwd-tree is CURRENT" "$CUR" \
  "cd $STALE && python3 -c \"open('briefs/SHARED-BRIEF.md','w').write('v3')\""

# ANTI-VACUITY: a "fix" that blanket-allows or blanket-denies must not pass. Same two trees,
# cwd already inside the tree the cd names.
expectcmd_from DENY  "bash cd->STALE, cwd inside IT - still denied"  "$STALE" \
  "cd $STALE && python3 -c \"open('briefs/SHARED-BRIEF.md','w').write('v3')\""
expectcmd_from ALLOW "bash cd->CURRENT, cwd inside IT - still allowed" "$CUR" \
  "cd $CUR && python3 -c \"open('briefs/SHARED-BRIEF.md','w').write('v3')\""

# ── THE TREE THAT DOES NOT EXIST YET (measured 2026-09-10) ────────────────────────────────────
# `git worktree add <p> && cd <p> && cat >> briefs/X.md` reaches this hook BEFORE <p> exists, so the
# `-d` test fails, `edit_dir` falls back to the hook's cwd, and the verdict is measured against the
# shared root — 33 commits behind at the time, producing a denial that listed ten commits the new
# worktree already contained. It cannot be repaired silently (at PreToolUse there is no tree to ask,
# so any base would be a guess) and it fails CLOSED, which is the safe direction. What is asserted
# here is that the denial SAYS SO: a block that cannot explain itself trains the reader to reach for
# the escape hatch by reflex, and a hatch-by-reflex guard is one that fails the day it is right.
msgcmd_from() { # msgcmd_from <cwd> <command> — the hook's stderr
  ( cd "$1" && jq -nc --arg c "$2" '{tool_input:{command:$c}}' | bash "$H" 2>&1 >/dev/null )
}
ghost="$STALE/does-not-exist-yet"
ghost_cmd="cd $ghost && python3 -c \"open('briefs/SHARED-BRIEF.md','w').write('v3')\""
expectcmd_from DENY "bash cd->a tree that does not exist yet - still denied" "$STALE" "$ghost_cmd"
gm="$(msgcmd_from "$STALE" "$ghost_cmd")"
case "$gm" in
  *"THIS BASE IS THE SHARED ROOT'S"*) printf '  ok    %-58s %s\n' "...and the denial NAMES the missing tree" "explained" ;;
  *) printf '  FAIL  %-58s %s\n' "...and the denial NAMES the missing tree" "message does not explain the fallback"; fail=$((fail+1)) ;;
esac
case "$gm" in
  *"$ghost"*) printf '  ok    %-58s %s\n' "...and quotes the path it could not resolve" "quoted" ;;
  *) printf '  FAIL  %-58s %s\n' "...and quotes the path it could not resolve" "path absent from message"; fail=$((fail+1)) ;;
esac
# ANTI-VACUITY for the message: a tree that DOES exist must NOT carry the explanation, or the note
# becomes wallpaper on every denial and stops meaning anything.
em="$(msgcmd_from "$STALE" "cd $STALE && python3 -c \"open('briefs/SHARED-BRIEF.md','w').write('v3')\"")"
case "$em" in
  *"THIS BASE IS THE SHARED ROOT'S"*) printf '  FAIL  %-58s %s\n' "...and an EXISTING tree carries no such note" "note leaked onto a normal denial"; fail=$((fail+1)) ;;
  *) printf '  ok    %-58s %s\n' "...and an EXISTING tree carries no such note" "clean" ;;
esac

# ...and an unparseable/absent cd must fall back to the old behaviour rather than erroring:
# cwd is the STALE tree and nothing names another, so the stale answer still applies.
expectcmd_from DENY  "bash with NO cd - falls back to cwd (stale)"   "$STALE" \
  "python3 -c \"open('briefs/SHARED-BRIEF.md','w').write('v3')\""

echo
echo "### file integrity"
if grep -qP '[\x00-\x08\x0b\x0c\x0e-\x1f]' "$H"; then
  echo "  FAIL  control character in the hook"; fail=$((fail+1))
else echo "  ok    no control characters"; fi
# This hook INVERTS the sibling's shape: every ALLOW leaves early via `… || exit 0`, so the
# terminal statement is the DENY. The dead-code hazard is therefore an UNCONDITIONAL bare
# `exit 0` on its own line — one of those short-circuits the guard into a no-op while every
# behavioural case above still reads green, because the harness only sees "not 2".
if [ "$(tail -n1 "$H")" = "exit 2" ]; then echo "  ok    terminal statement is the DENY (exit 2)"
else echo "  FAIL  last line is '$(tail -n1 "$H")', not 'exit 2' — the guard may fall through to ALLOW"; fail=$((fail+1)); fi
n=$(grep -cE '^[[:space:]]*exit 0[[:space:]]*$' "$H")
if [ "$n" -ne 0 ]; then echo "  FAIL  $n unconditional bare 'exit 0' — everything below it is DEAD CODE"; fail=$((fail+1))
else echo "  ok    no unconditional early exit (every ALLOW is guarded by a condition)"; fi
bash -n "$H" && echo "  ok    syntax"

echo
echo "### A STALE SHARED ROOT MUST NOT DENY AN EDIT IN A CURRENT WORKTREE"
# Residue `2026-09-05-sync-main-skips-while-root-dirty`. The guard's base is
# `merge-base(HEAD, origin/main)` of the tree it RESOLVES, and `tepna-sync-main.timer` refuses to
# fast-forward the shared root while it holds uncommitted paths — its normal state here — so the
# root sits chronically behind. Measured on rig-x870: 42 commits behind at 02:15 with 7 dirty paths.
#
# The behaviour below was already CORRECT and entirely unpinned, which is the real exposure: nothing
# would have caught a regression reintroducing the 2026-08-20 false denials. Each case states WHICH
# tree it identifies, because that — not the root's staleness — is what decides the answer.
# `--branch main` is load-bearing: the bare upstream's HEAD still points at `master`, so a plain
# clone checks nothing out and every later query answers "fatal: Needed a single revision" —
# which the fixture non-vacuity check below catches rather than letting the ALLOWs pass empty.
STALE="$TMP/stale"; git clone -q --branch main "$UP" "$STALE" 2>/dev/null
( cd "$STALE" && git config user.email t@t && git config user.name t \
    && git fetch -q origin main 2>/dev/null && git checkout -q -B main HEAD~1 ) >/dev/null 2>&1
git -C "$STALE" worktree add -q "$TMP/fresh" -b fresh origin/main >/dev/null 2>&1
sb="$(git -C "$STALE" rev-list --count HEAD..origin/main 2>/dev/null)"
fb="$(git -C "$TMP/fresh" rev-list --count HEAD..origin/main 2>/dev/null)"
if [ "${sb:-0}" -ge 1 ] && [ "${fb:-1}" -eq 0 ]; then
  echo "  ok    fixture is non-vacuous — root $sb behind, worktree $fb behind"
else
  echo "  FAIL  fixture did not build a stale root beside a current worktree (${sb:-?} / ${fb:-?})"; fail=$((fail+1))
fi
# Run from the STALE root's cwd, exactly as a PreToolUse hook does.
rr() { ( cd "$STALE" && printf '%s' "$1" | bash "$H" >/dev/null 2>&1; [ $? -eq 2 ] && echo DENY || echo ALLOW ); }
HOOKDIR="$(cd "$(dirname "$H")" && pwd)"
expectr() { local got; got="$(rr "$3")"
  if [ "$got" = "$1" ]; then printf '  ok    %-58s %s\n' "$2" "$got"
  else printf '  FAIL  %-58s got %s, want %s\n' "$2" "$got" "$1"; fail=$((fail+1)); fi; }

expectr ALLOW "current worktree named by ABSOLUTE file_path"  "{\"tool_input\":{\"file_path\":\"$TMP/fresh/briefs/SHARED-BRIEF.md\"}}"
expectr ALLOW "current worktree named by a leading cd"        "{\"tool_input\":{\"command\":\"cd $TMP/fresh && sed -i s/a/b/ briefs/SHARED-BRIEF.md\"}}"
# The paired DENYs differ in ONE property: the tree named is the STALE one, not the current one.
expectr DENY  "…and the STALE tree by absolute path still denies" "{\"tool_input\":{\"file_path\":\"$STALE/briefs/SHARED-BRIEF.md\"}}"
expectr DENY  "…and the STALE tree by a leading cd still denies"  "{\"tool_input\":{\"command\":\"cd $STALE && sed -i s/a/b/ briefs/SHARED-BRIEF.md\"}}"

# THE RESIDUAL GAP, pinned as the behaviour it HAS rather than the one the docs claimed. With no
# file_path and no parseable `cd` there is NO signal identifying the edited tree, so the hook
# measures its own cwd. A denial here is possible ONLY while that tree is stale — when it is current
# the base IS origin/main and the range is empty by construction — so this route cannot distinguish
# "you are editing this stale tree" (deny is right) from "you are editing elsewhere" (deny is a
# false positive). Pinned so the limitation is visible, not so it is endorsed.
expectr DENY  "no tree signal → measured against cwd (documented gap)" '{"tool_input":{"command":"sed -i s/a/b/ briefs/SHARED-BRIEF.md"}}'

echo
echo "### A HEREDOC BODY IS DATA — the sibling's rule, which this hook never got (#2871's blind half)"
# Measured 2026-09-22, twice in one hour and in opposite lanes: a peer writing a note to the MEMORY
# directory (no repo file touched at all) and this hook's own author writing a reproduction script
# were both DENIED, because each command's heredoc body QUOTED a guarded path — and one quoted a
# `sed -i` inside a string literal. Describing a file read as editing it. Every DENY below is paired
# with an ALLOW differing in ONE property, and all of them name the STALE tree, so an ALLOW is the
# strip working rather than the staleness query finding nothing.
expectr ALLOW "heredoc body merely QUOTES a guarded path (cat: not an interpreter)" \
  "{\"tool_input\":{\"command\":\"cd $STALE && cat > /tmp/note.md <<'EOF'\nthe row lives in briefs/SHARED-BRIEF.md and is appended there\nEOF\"}}"
expectr ALLOW "…and a body quoting a sed -i as PROSE (the exact 2026-09-22 shape)" \
  "{\"tool_input\":{\"command\":\"cd $STALE && cat > /tmp/repro.py <<'PY'\ncases = {'real': \\\"sed -i s/x/y/ briefs/SHARED-BRIEF.md\\\"}\nPY\"}}"
# ANTI-VACUITY, and the reason the strip is INTERPRETER-AWARE: for `python3 - <<PY` the body IS the
# program — the computed-edit case §3 added Bash matching for — so it must stay visible.
expectr DENY  "an INTERPRETER heredoc that writes a guarded path is still seen" \
  "{\"tool_input\":{\"command\":\"cd $STALE && python3 - <<'PY'\nopen('briefs/SHARED-BRIEF.md','w').write('x')\nPY\"}}"
expectr DENY  "…and a plain in-place edit is unaffected by the strip" \
  "{\"tool_input\":{\"command\":\"cd $STALE && sed -i s/a/b/ briefs/SHARED-BRIEF.md\"}}"

# THE REPORTED CASE, and it is a COMPOUND neither block reproduces alone: the guarded path is quoted
# as PROSE in a `cat <<MD` body, and the write verb (`open(p,'w').write(`) lives in a SECOND,
# interpreter heredoc whose own path is a different file entirely. The hook ANDs "a guarded path
# appears anywhere" with "looks_like_write sees a verb anywhere", so the two blocks together denied
# while either alone allowed — which is why the first reconstruction of this report passed on both
# copies and proved nothing. Measured against the real command, 2026-09-22 (Osprey).
expectr ALLOW "two heredocs: path as prose in one, write verb in the other (the reported case)" \
  "{\"tool_input\":{\"command\":\"cd $STALE && cat > /tmp/note.md <<'MD'\nthe row lives in briefs/SHARED-BRIEF.md\nMD\npython3 - <<'PY'\nopen('/tmp/other.md','w').write('x')\nPY\"}}"
# The same command with the python block swapped for a plain append — the discriminator that proves
# the write verb came from the interpreter block and not from the prose one.
expectr ALLOW "…and with the second block a plain append instead" \
  "{\"tool_input\":{\"command\":\"cd $STALE && cat > /tmp/note.md <<'MD'\nthe row lives in briefs/SHARED-BRIEF.md\nMD\nprintf x >> /tmp/other.md\"}}"
# ⚠ KNOWN GAP, PINNED RATHER THAN HIDDEN (row 2026-09-23-heredoc-strip-is-decided-once-for-many).
# The anti-vacuity leg for this pair SHOULD be a DENY — a guarded path inside an INTERPRETER body is
# code, and the strip is about which body is data, never about how many bodies there are. It is an
# ALLOW today, in BOTH copies, because the rule decides interpreter-vs-data ONCE for the FIRST
# heredoc and then applies `sed … /g`, which blanks every later body including an interpreter's.
# Measured on the sibling with a positive control, so this is a false NEGATIVE in the blanket-git
# guard and not merely cosmetic here: `git add -A` DENIES inside one interpreter heredoc and ALLOWS
# when a plain heredoc precedes it. Pre-existing on main, inherited by this port rather than
# introduced by it, and fixed in its own unit — this line asserts what the hook DOES so the day it
# starts denying, the suite says so.
expectr ALLOW "⚠ KNOWN GAP: a path in a SECOND, interpreter heredoc is stripped too" \
  "{\"tool_input\":{\"command\":\"cd $STALE && cat > /tmp/note.md <<'MD'\nharmless prose\nMD\npython3 - <<'PY'\nopen('briefs/SHARED-BRIEF.md','w').write('x')\nPY\"}}"

echo
echo "### A MERGE IN PROGRESS IS THE REMEDY BEING PERFORMED, NOT A STALE TREE"
# Mid-merge, HEAD is the PRE-merge commit while the working tree already carries the upstream text —
# so measured against HEAD alone every upstream commit reads as one the author does not have, and the
# guard denies the resolution edit while pointing at the very commits they are looking at. Reported
# 2026-09-23 by a session resolving a ledger conflict; reproduced here with both controls, because a
# false positive whose only way out is the escape hatch is how a hatch becomes reflex.
MM="$TMP/midmerge"
mkdir -p "$MM/up/briefs"
( cd "$MM/up" && git init -q . && git config user.email t@t && git config user.name t \
  && printf 'base\n' > briefs/SHARED-BRIEF.md && git add -A && git commit -qm base && git branch -M main ) >/dev/null 2>&1
( git clone -q "$MM/up" "$MM/work" && cd "$MM/work" && git config user.email t@t && git config user.name t \
  && git checkout -qb feature && printf 'base\nmine\n' > briefs/SHARED-BRIEF.md && git commit -qam mine ) >/dev/null 2>&1
( cd "$MM/up" && printf 'base\nUPSTREAM\n' > briefs/SHARED-BRIEF.md && git commit -qam upstream ) >/dev/null 2>&1
( cd "$MM/work" && git fetch -q origin main ) >/dev/null 2>&1

# The paired DENY: same tree, same branch, same upstream — differing ONLY in that no merge is running.
expectr DENY  "stale branch, no merge running → denies (the case it exists for)" \
  "{\"tool_input\":{\"command\":\"cd $MM/work && sed -i s/a/b/ briefs/SHARED-BRIEF.md\"}}"

( cd "$MM/work" && git merge origin/main >/dev/null 2>&1; printf 'base\nmine\nUPSTREAM\n' > briefs/SHARED-BRIEF.md; git add briefs/SHARED-BRIEF.md ) >/dev/null 2>&1
if [ -f "$MM/work/.git/MERGE_HEAD" ]; then
  echo "  ok    fixture is non-vacuous — MERGE_HEAD is set and the upstream text is in the tree"
else
  echo "  FAIL  fixture did not leave a merge in progress; the leg below would prove nothing"
  fail=$((fail + 1))
fi
expectr ALLOW "…and mid-merge, with the upstream commits already in the tree, it does not" \
  "{\"tool_input\":{\"command\":\"cd $MM/work && sed -i s/a/b/ briefs/SHARED-BRIEF.md\"}}"

# ANTI-VACUITY: the relaxation is keyed on the merge being IN PROGRESS, not on the file. Finish the
# merge and the answer must stay ALLOW for the right reason — the commits are genuinely in HEAD now.
( cd "$MM/work" && git commit -qm merge ) >/dev/null 2>&1
expectr ALLOW "…and after the merge commit, for the ordinary reason" \
  "{\"tool_input\":{\"command\":\"cd $MM/work && sed -i s/a/b/ briefs/SHARED-BRIEF.md\"}}"

# A conflicted CHERRY-PICK of an upstream commit is the same situation by a different command, and it
# is in the fix on its own measurement rather than by analogy with the merge case: DENY before the
# change, ALLOW after, stale control unchanged. (`REVERT_HEAD` is deliberately not covered — see the
# hook's header: measuring it showed it is either a no-op or a false allow.)
CP="$TMP/cherrypick"
mkdir -p "$CP/up/briefs"
( cd "$CP/up" && git init -q . && git config user.email t@t && git config user.name t \
  && printf 'base\n' > briefs/SHARED-BRIEF.md && git add -A && git commit -qm base && git branch -M main ) >/dev/null 2>&1
( git clone -q "$CP/up" "$CP/work" && cd "$CP/work" && git config user.email t@t && git config user.name t \
  && git checkout -qb feature && printf 'base\nmine\n' > briefs/SHARED-BRIEF.md && git commit -qam mine ) >/dev/null 2>&1
( cd "$CP/up" && printf 'base\nUPSTREAM\n' > briefs/SHARED-BRIEF.md && git commit -qam upstream ) >/dev/null 2>&1
( cd "$CP/work" && git fetch -q origin main && git cherry-pick "$(git rev-parse origin/main)" >/dev/null 2>&1
  printf 'base\nmine\nUPSTREAM\n' > briefs/SHARED-BRIEF.md; git add briefs/SHARED-BRIEF.md ) >/dev/null 2>&1
if [ -f "$CP/work/.git/CHERRY_PICK_HEAD" ]; then
  echo "  ok    fixture is non-vacuous — CHERRY_PICK_HEAD is set"
else
  echo "  FAIL  no cherry-pick in progress; the leg below would prove nothing"
  fail=$((fail + 1))
fi
expectr ALLOW "…and a conflicted cherry-pick of the upstream commit, likewise" \
  "{\"tool_input\":{\"command\":\"cd $CP/work && sed -i s/a/b/ briefs/SHARED-BRIEF.md\"}}"

echo
echo "### THE TWO COPIES OF THE STRIPPER STAY BYTE-IDENTICAL"
# The rule lives in two hooks because each is invoked standalone and must work from a checkout that
# carries no shared helper. A copy that drifts is exactly how ONE of them was fixed in #2871 and the
# other was not, so the parity is asserted rather than trusted.
# Normalised on the ONE thing that legitimately differs: each hook names its folded command
# variable for itself ($cmdn there, $cmdf here). Everything else must match byte for byte.
_strip_of() { sed -n '/^cmd_nohere=/,/^fi$/p' "$1" | sed 's/\$cmdn/$C/g; s/\$cmdf/$C/g'; }
_A="$(_strip_of "$HOOKDIR/guard-shared-tree.sh")"
_B="$(_strip_of "$HOOKDIR/guard-stale-brief.sh")"
if [ -n "$_A" ] && [ "$_A" = "$_B" ]; then
  echo "  ok    guard-shared-tree and guard-stale-brief carry the same heredoc rule"
else
  echo "  FAIL  the heredoc stripper DRIFTED between the two hooks (or could not be extracted)"
  fail=$((fail + 1))
fi

echo
echo "### THE DENIAL NAMES THE TREE IT MEASURED — and cd_missing is found wherever it sits"
# Measured 2026-09-23: `cd <root> && git worktree add <wt> && cd <wt> && <edit>` was denied with
# "91 commit(s) you do not have" and NO tree named, against a worktree that was AT origin/main.
# The first `cd` was the root — which EXISTS — so the head -1 rule claimed it and `cd_missing`
# stayed empty. The root has to be the first cd: it is where `git worktree add` runs.
bashrun() { # bashrun <command> ; echoes the stderr
  #  ⚠ ANTI-VACUITY: an UNPARSEABLE payload makes the hook exit 0 with no output, which reads
  #     exactly like "the rule did not fire". The first draft of these legs escaped `&&` as `\&\&`,
  #     which is not a JSON escape, so jq returned nothing and two legs failed against a hook that
  #     was correct. Assert the payload parses before trusting any verdict drawn from it.
  local js; js="$(printf '{"tool_input":{"command":"%s"}}' "$1")"
  printf '%s' "$js" | jq -e '.tool_input.command' >/dev/null 2>&1 || {
    echo "  FAIL  bashrun payload is not valid JSON — every verdict below would be vacuous"
    fail=$((fail+1)); return
  }
  printf '%s' "$js" | bash "$H" 2>&1 >/dev/null
}
MSG_PLAIN="$(bashrun "sed -i s/a/b/ briefs/SHARED-BRIEF.md")"
if printf '%s' "$MSG_PLAIN" | grep -q 'MEASURED AGAINST:'; then echo "  ok    a denial names the tree it measured"
else echo "  FAIL  denial does not name the tree"; fail=$((fail+1)); fi
if printf '%s' "$MSG_PLAIN" | grep -qE 'behind origin/main|distance from origin/main unknown'; then echo "  ok    …and how far behind that tree is"
else echo "  FAIL  denial does not give the distance"; fail=$((fail+1)); fi

# THE SHAPE THAT DEFEATED IT: a leading cd to an EXISTING dir, then the worktree that does not exist.
MISSING="$TMP/not-created-yet"
MSG_WT="$(bashrun "cd $WORK && git worktree add $MISSING && cd $MISSING && sed -i s/a/b/ briefs/SHARED-BRIEF.md")"
if printf '%s' "$MSG_WT" | grep -q 'THIS BASE IS THE SHARED ROOT'; then echo "  ok    a LATER cd to a not-yet-created tree is still detected (was: only the first cd)"
else echo "  FAIL  cd_missing missed a non-first cd — the worktree-creating shape"; fail=$((fail+1)); fi
if printf '%s' "$MSG_WT" | grep -qF "$MISSING"; then echo "  ok    …and the notice names which directory does not exist yet"
else echo "  FAIL  notice does not name the missing dir"; fail=$((fail+1)); fi
# NARROWNESS: an ordinary subdirectory hop to a dir that EXISTS must not be reported as missing.
MSG_HOP="$(bashrun "cd $WORK && cd briefs && sed -i s/a/b/ SHARED-BRIEF.md")"
if printf '%s' "$MSG_HOP" | grep -q 'THIS BASE IS THE SHARED ROOT'; then echo "  FAIL  an existing subdirectory hop was reported as a missing tree"; fail=$((fail+1));
else echo "  ok    an existing subdirectory hop is NOT reported as a missing tree"; fi

echo
[ "$fail" -eq 0 ] && echo "PASS — every DENY paired with an ALLOW that differs in one property" \
                  || echo "FAIL — $fail problem(s)"
exit $((fail > 0))
