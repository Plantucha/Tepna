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
[ "$fail" -eq 0 ] && echo "PASS — every DENY paired with an ALLOW that differs in one property" \
                  || echo "FAIL — $fail problem(s)"
exit $((fail > 0))
