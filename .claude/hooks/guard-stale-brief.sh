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

# stdin is readable ONCE, and this hook now asks it two questions (Edit/Write carry a
# `file_path`; Bash carries a `command`), so the payload is buffered rather than piped twice.
# ⚠ STDIN IS DRAINED FIRST, BEFORE ANY EXIT. The harness writes the tool-call JSON into this
# hook's stdin, so a hatch that exits before reading it leaves the writer on a closed pipe and
# the writer takes SIGPIPE (141 under `pipefail`). Same contract and same fix as trim-output.sh
# (#3493). The test reads the WRITER's fate, because a verdict of "not 2" cannot see it.
payload="$(cat 2>/dev/null)" || exit 0
[ "${CLAUDE_ALLOW_STALE_BRIEF:-}" = "1" ] && exit 0
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
# GUARDED SET — the hot shared docs. `briefs/*.md` is where the collision happened;
# DOCS-INDEX.md is the dashboard every brief change touches, so it collides for the
# same reason and by the same mechanism.
GUARDED_RE='(briefs/[A-Za-z0-9._@+-]+\.md|DOCS-INDEX\.md)'

# ── THE INTERPRETER VOCABULARIES — A READ ALLOWLIST, AND THE WRITES IT STILL NAMES ─────────────
#    Owner ruling 1 on fleet board #1549, 2026-10-26: invert the write-verb list to a read
#    allowlist that fails closed. `WRITE_VERB_RE` survives the inversion for ONE reason — it names
#    the verb in the denial, and it denies a program that reads a guarded doc and then writes it.
#    `READ_FORM_RE` is the allowlist. A form in neither list is UNKNOWN, and unknown denies.
WRITE_VERB_RE="(open\([^)]*['\"][wax]|\.write_text\(|\.write_bytes\(|\.writelines\(|\.write\(|writeFileSync|appendFileSync|writeFile\(|createWriteStream\(|shutil\.(copy|copy2|copyfile|move)\(|os\.(replace|rename|remove|unlink)\(|\.replace\(|\.unlink\(|>>?[[:space:]]*['\"]?briefs/)"
READ_FORM_RE="(open\([^,)]*\)|open\([^)]*['\"]r[b+]*['\"]|\.read_text\(|\.read_bytes\(|\.readlines\(|\.read\(|readFileSync\(|readFile\(|json\.load\(|yaml\.safe_load\(|\.exists\(|\.is_file\(|\.glob\(|\.rglob\(|\.stat\()"

# ── ARGV_TARGET_RE — THE SECOND CHANNEL, AND IT IS A TARGET SLOT RATHER THAN A VERB ────────────
#    Row 2026-10-28-a-guarded-path-reaching-a-program-through-argv-is-invisible-to-the-guard. In
#    `python3 - briefs/X-BRIEF.md <<PY ... open(sys.argv[1], 'w') ... PY` the two halves of the
#    evidence arrive through DIFFERENT CHANNELS: the path stands in the command line with no write
#    verb beside it, and the program names a write with no guarded path in it. Each half alone reads
#    as a read, so neither arm fires and a real write of a stale guarded doc lands.
#
#    THE JOIN IS A TARGET SLOT, NOT A VERB LIST. `WT_SCAN` already resolves every write form's
#    target, and already denies one it cannot resolve to a literal while NAMING the expression it
#    read. This pattern asks one question of that name: is the target an argument? A guarded path in
#    the interpreter's own argument list then completes the evidence. So nothing here enumerates
#    verbs, and the owner ruling that replaced the verb list with a read allowlist still holds.
ARGV_TARGET_RE='(sys\.argv|process\.argv|\$ARGV|@ARGV|ARGV\[|\bargv\[)'


# ── WT_SCAN — WHICH PATH DOES THIS PROGRAM ACTUALLY WRITE? ────────────────────────────────────
#    An awk reader of interpreter program text. It answers one of three things on stdout:
#      DENY <reason>  a write whose target is a guarded path, or one it cannot resolve to a literal
#      ALLOW <n>      n target-bearing writes, every target resolved, none of them guarded
#      NOWRITE        no target-bearing write form at all — the caller falls back to its old rule
#
#    HOW IT READS A TARGET. String literals are masked out first, so every later rule runs over text
#    with no quoting left to misread. Then each write form is looked up in a slot table, because the
#    target does not sit in one place: `open(T, "w")` and `writeFileSync(T, …)` name it first,
#    `shutil.copy(src, T)` and `os.replace(src, T)` name it last, `Path(T).write_text(…)` names it
#    as the receiver, and `Path(src).replace(T)` names it as the argument while the receiver is the
#    source. A list of verbs cannot tell those apart, which is why the old arm denied on the verb.
#
#    WHAT MAKES IT SAFE. Three fail-closed rules, each measured rather than assumed:
#      · a target that is not a literal and not a variable holding one DENIES (argv, a concatenation,
#        an f-string, a reassigned name) — so the variable case keeps its denial;
#      · a program that shells out DENIES, because `os.system("cp x briefs/X.md")` writes through a
#        channel no slot table can read;
#      · an unterminated string literal DENIES, since the mask cannot be trusted past it.
#
#    WHAT IT DOES NOT MODEL, stated rather than discovered later: a shell body handed to `bash <<SH`
#    (the caller's own redirect test covers the outside text, not a kept body), and a target built by
#    concatenation from pieces no single literal spells, which is a residue row of its own, filed
#    with the measurement that found it. A guarded path reaching the program as an ARGUMENT was the
#    third of these. This scan still cannot resolve such a target, and that unresolved name is now
#    the evidence the CALLER joins to the command line — see `ARGV_TARGET_RE` above.
WT_SCAN='# wtscan.awk — read interpreter PROGRAM TEXT on stdin, print one verdict line.
#   DENY <reason>      a write whose target is a guarded path, or one this scan cannot resolve
#   ALLOW <n>          n target-bearing writes, every target resolved and none guarded
#   NOWRITE            no target-bearing write form found at all
# -v guarded=<ERE>
BEGIN { SQ = sprintf("%c", 39); DQ = sprintf("%c", 34); BQ = sprintf("%c", 96) }
{ src = src $0 "\n" }
END {
  n = length(src); masked = ""; nlit = 0; q = ""
  for (i = 1; i <= n; i++) {
    c = substr(src, i, 1)
    if (q != "") {
      if (c == "\\") { cur = cur substr(src, i+1, 1); i++; continue }
      if (c == q) { nlit++; lit[nlit] = cur; masked = masked "@L" nlit "@"; q = ""; cur = "" ; continue }
      cur = cur c; continue
    }
    if (c == SQ || c == DQ || c == BQ) { q = c; cur = ""; continue }
    if (c == "\n" || c == "\t") { masked = masked " "; continue }
    masked = masked c
  }
  if (q != "") { print "DENY an unterminated string literal, so the program text cannot be read"; exit }

  # ── one level of literal resolution: IDENT = "literal", and a handle from open("literal", …) ──
  m = masked
  while (match(m, /[A-Za-z_][A-Za-z_0-9]*[ ]*=[ ]*@L[0-9]+@/)) {
    s = substr(m, RSTART, RLENGTH); m = substr(m, RSTART + RLENGTH)
    name = s; sub(/[ ]*=.*/, "", name); idx = s; sub(/.*@L/, "", idx); sub(/@$/, "", idx)
    if (name in map && map[name] != lit[idx+0]) map[name] = "\001AMBIGUOUS"; else map[name] = lit[idx+0]
  }
  m = masked
  while (match(m, /[A-Za-z_][A-Za-z_0-9]*[ ]*=[ ]*(io\.|codecs\.)?open\([ ]*@L[0-9]+@/)) {
    s = substr(m, RSTART, RLENGTH); m = substr(m, RSTART + RLENGTH)
    name = s; sub(/[ ]*=.*/, "", name); idx = s; sub(/.*@L/, "", idx); sub(/@$/, "", idx)
    if (name in map && map[name] != lit[idx+0]) map[name] = "\001AMBIGUOUS"; else map[name] = lit[idx+0]
  }
  m = masked
  while (match(m, /with[ ]+(io\.|codecs\.)?open\([ ]*@L[0-9]+@[^)]*\)[ ]*as[ ]+[A-Za-z_][A-Za-z_0-9]*/)) {
    s = substr(m, RSTART, RLENGTH); m = substr(m, RSTART + RLENGTH)
    name = s; sub(/.*as[ ]+/, "", name); idx = s; sub(/.*@L/, "", idx); sub(/@.*/, "", idx)
    if (name in map && map[name] != lit[idx+0]) map[name] = "\001AMBIGUOUS"; else map[name] = lit[idx+0]
  }

  # ── a program that shells out writes through a channel this scan cannot read ──
  if (masked ~ /(^|[^A-Za-z_0-9])(os\.system|os\.popen|subprocess|Popen|child_process|execSync|execFileSync|spawnSync|spawn\(|exec\()/) {
    print "DENY the program shells out, so a write can leave through a channel this scan cannot read"; exit
  }

  writes = 0
  nw = split("", W)
  # target-bearing write forms, with WHERE the target sits: A1 first argument, AL last argument,
  # RX the receiver standing before the dot.
  nw = scan(masked, "(^|[^A-Za-z_0-9.])open\\(", "A1", "MODEW") + nw
  nw = scan(masked, "(^|[^A-Za-z_0-9])(writeFileSync|appendFileSync|writeFile|createWriteStream)\\(", "A1", "") + nw
  nw = scan(masked, "(^|[^A-Za-z_0-9])shutil\\.(copy|copy2|copyfile|move)\\(", "AL", "") + nw
  nw = scan(masked, "(^|[^A-Za-z_0-9])os\\.(replace|rename)\\(", "AL", "") + nw
  nw = scan(masked, "(^|[^A-Za-z_0-9])os\\.(remove|unlink)\\(", "A1", "") + nw
  nw = scan(masked, "(^|[^A-Za-z_0-9])(os|shutil|fs|path)\\.[a-z_]+\\(", "SKIP", "") + nw
  nw = scan(masked, "\\.(write_text|write_bytes|unlink)\\(", "RX", "") + nw
  nw = scan(masked, "\\.(replace|rename)\\(", "A1SOFT", "") + nw
  if (verdict != "") { print verdict; exit }
  if (nw == 0) { print "NOWRITE"; exit }
  print "ALLOW " nw
}

# scan: find every occurrence of pat in s, pull its target, judge it. Returns the count found.
function scan(s, pat, where, modegate,   found, pos, rest, open_at, args, na, tgt, i, val, head) {
  found = 0; pos = 0; rest = s
  while (match(rest, pat)) {
    head = RSTART + RLENGTH - 1                     # index of the "(" inside rest
    while (substr(rest, head, 1) != "(" && head <= length(rest)) head++
    na = arglist(rest, head, args)
    if (na < 0) { verdict = "DENY a write call this scan cannot split into arguments"; return found }
    if (modegate == "MODEW") {
      if (na < 2) { rest = substr(rest, head + 1); continue }   # open(x) with no mode is a READ
      val = resolve(args[2])
      if (val == "\001UNRESOLVED") { rest = substr(rest, head + 1); continue }
      if (val !~ /[wax]/) { rest = substr(rest, head + 1); continue }
    }
    found++
    if (where == "SKIP") { found--; rest = substr(rest, head + 1); continue }
    if (where == "A1") tgt = args[1]
    else if (where == "AL") tgt = args[na]
    else tgt = receiver(rest, RSTART + RLENGTH - length(pat))
    if (where == "RX") tgt = receiver_before(rest, head)
    if (where == "A1SOFT") tgt = args[1]
    val = resolve(tgt)
    # `.replace(` and `.rename(` move the receiver ONTO their first argument, which is the target.
    # Both are also string methods, so an argument this scan cannot resolve is not evidence of a file
    # write at all. Every other form in this table names a file and fails closed.
    if (where == "A1SOFT" && val == "\001UNRESOLVED") { found--; rest = substr(rest, head + 1); continue }
    if (val == "\001UNRESOLVED") {
      verdict = "DENY a write whose target this scan cannot resolve to a literal path: " trim(tgt)
      return found
    }
    if (val ~ guarded) {
      verdict = "DENY a write whose target IS a guarded path: " val
      return found
    }
    rest = substr(rest, head + 1)
  }
  return found
}

# arglist: fill args[1..n] with the top-level comma-separated arguments of the call whose "(" is at k.
function arglist(s, k, args,   depth, i, cur, n, c) {
  depth = 0; n = 0; cur = ""
  for (i = k; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "(" || c == "[" || c == "{") { depth++; if (depth == 1) continue; cur = cur c; continue }
    if (c == ")" || c == "]" || c == "}") { depth--; if (depth == 0) { n++; args[n] = cur; return n } cur = cur c; continue }
    if (c == "," && depth == 1) { n++; args[n] = cur; cur = ""; continue }
    cur = cur c
  }
  return -1
}

# receiver_before: the expression standing immediately before the ".verb(" at k.
function receiver_before(s, k,   i, depth, c, start) {
  i = k - 1
  while (i > 0 && substr(s, i, 1) != ".") i--      # back to the dot
  i--
  if (i <= 0) return "\001UNRESOLVED"
  if (substr(s, i, 1) == ")") {                    # a call: Path("x") / Path(p)
    depth = 0
    for (; i > 0; i--) {
      c = substr(s, i, 1)
      if (c == ")") depth++
      else if (c == "(") { depth--; if (depth == 0) break }
    }
    if (i <= 0) return "\001UNRESOLVED"
    if (arglist(s, i, A) < 1) return "\001UNRESOLVED"
    return A[1]
  }
  start = i
  while (start > 0 && substr(s, start, 1) ~ /[A-Za-z_0-9@]/) start--
  return substr(s, start + 1, i - start)
}
function receiver(s, k) { return receiver_before(s, k) }

function resolve(t,   v, idx) {
  t = trim(t)
  if (t ~ /^@L[0-9]+@$/) { idx = t; sub(/^@L/, "", idx); sub(/@$/, "", idx); return lit[idx+0] }
  if (t ~ /^[A-Za-z_][A-Za-z_0-9]*$/ && (t in map)) { v = map[t]; if (v == "\001AMBIGUOUS") return "\001UNRESOLVED"; return v }
  return "\001UNRESOLVED"
}
function trim(t) { gsub(/^[ \t]+|[ \t]+$/, "", t); return t }'

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

  #    ⚠ A `cd` IS NOT THE ONLY WAY A COMMAND NAMES ITS TREE. A computed edit writing an
  #      ABSOLUTE guarded path carries its tree in the path it writes, and the Edit/Write route
  #      has read exactly that since 2026-08-18 while this route never did. Measured 2026-10-26:
  #      a write-shaped append to `<worktree>/briefs/X-BRIEF.md` was measured against a root 101
  #      commits behind and denied, while the same append after a `cd` passed. So the more
  #      exactly a session follows §👥.1 the more reliably this guard denied it, and the hatch
  #      became reflex.
  #      The path names an EXISTING tree, so unlike `cd_missing` above nothing is guessed here,
  #      and the signal can only move the query CLOSER to the tree being written.
  #      ⚠ A `git -C <dir>` target is deliberately NOT read here, though `guard-format.sh:107`
  #      takes one first. On THIS route the write is usually relative to the cwd, so an unrelated
  #      `-C` clause beside it would move the base AWAY from the tree being written — a false
  #      NEGATIVE, the direction this guard exists to avoid. `guard-stale-ledger.sh` reads a `-C`
  #      only from the clause that names the ledger, where the target IS the acting tree.
  #      An absolute guarded path names its tree too, and the Edit/Write route has read one since
  #      2026-08-18. The Bash route never did: a computed edit writing
  #      `<worktree>/briefs/X-BRIEF.md` carries the tree in the path it writes.
  if [ "$edit_dir" = "." ]; then
    #      ⚠ ANCHORED ON THE WRITE, not on any absolute path in the text. A read of one tree
    #        beside a relative write in another (`grep x <wt>/briefs/A.md && sed -i … briefs/A.md`)
    #        must not move the base to the tree that was only READ: that would ALLOW the stale
    #        write, which is the false NEGATIVE this guard exists to avoid.
    _abs_path="$(printf '%s' "$cmd" \
      | grep -oE "(>>?|\btee\b|\bcp\b|\bmv\b|\btruncate\b|sed[[:space:]]+-i[^[:space:]]*|open\(['\"]?)[^|;&]*/[^[:space:];&|\"']*$GUARDED_RE" \
      | head -1 | grep -oE "/[^[:space:];&|\"']*$GUARDED_RE" | head -1)"
    if [ -n "$_abs_path" ]; then
      _abs_dir="$(dirname "$_abs_path")"
      [ -d "$_abs_dir" ] && edit_dir="$_abs_dir"
    fi
  fi
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
# ⚠ THE DECISION IS MADE PER HEREDOC, WALKING THE TEXT (residue 2026-09-23-heredoc-strip-is-decided-once-
#   for-many). It used to be made ONCE, for the first heredoc, and applied to all of them with `sed … /g`,
#   so a plain heredoc ahead of an interpreter one (`cat > n.md <<MD … MD` then `bash <<SH git add -A SH`)
#   blanked the interpreter's program too and every rule went blind to it. Now each `<<WORD` is judged on
#   the text between the previous heredoc's closer and itself — which is where its owner is named.
# ⚠ EVERY LINE FROM `cmd_nohere=` TO THE CLOSING `fi` IS PINNED BYTE-IDENTICAL to the copy in
#   `guard-shared-tree.sh`, and the self-test asserts it. A comment belongs ABOVE this line or BELOW
#   that `fi`, never between them — a nine-line note placed inside the span reded the parity leg while
#   every verdict stayed correct, so the tell was the leg and not the behaviour.
cmd_nohere=""
_hd_rest="$cmdf"
_hd_open="<<-?'?([A-Za-z_][A-Za-z0-9_]*)'?"
while [[ "$_hd_rest" =~ $_hd_open ]]; do
  _hd_tok="${BASH_REMATCH[0]}"; _hd_w="${BASH_REMATCH[1]}"
  _hd_pre="${_hd_rest%%"$_hd_tok"*}"
  _hd_post="${_hd_rest#*"$_hd_tok"}"
  # ⚠ THE STRIP FAILS CLOSED, reusing the rule the rebase-guard learned the hard way: a terminator word
  #   appearing a SECOND time as a standalone token lets a strip swallow real commands after the heredoc
  #   (measured 2026-08-05: a body ending `A`, then a real `git checkout origin/main -- oxydex-dsp.js`,
  #   then a stray `A` — the checkout was stripped and the rule passed). So act only when the terminator
  #   appears EXACTLY ONCE standalone in the whole command; otherwise keep the rest of the text raw.
  if [ "$(printf '%s' "$cmdf" | grep -oE "(^|[[:space:]])$_hd_w([[:space:]]|$)" | wc -l)" -ne 1 ] \
     || ! [[ "$_hd_post" =~ (^|[[:space:]])"$_hd_w"([[:space:]]|$) ]]; then
    break
  fi
  _hd_end="${BASH_REMATCH[0]}"
  _hd_body="${_hd_post%%"$_hd_end"*}"
  _hd_after="${_hd_post#*"$_hd_end"}"
  # Does the command OWNING this heredoc read it as a program? If so the body is CODE and every rule
  # keeps it raw — but it is still SKIPPED PAST to its closer, so text inside a program is never
  # mistaken for a further heredoc opener.
  if printf '%s' "$_hd_pre" | grep -qE '(^|[;&|[:space:]])(bash|sh|zsh|python3?|node|perl|ruby|php)([[:space:]]|$)'; then
    cmd_nohere="$cmd_nohere$_hd_pre$_hd_tok$_hd_body$_hd_end"
  else
    cmd_nohere="$cmd_nohere$_hd_pre "
  fi
  _hd_rest="$_hd_after"
done
if [ -n "$_hd_rest" ]; then
  cmd_nohere="$cmd_nohere$_hd_rest"
fi

# ── THE PARTITION BEHIND THE POSITION DIAGNOSTIC, COMPUTED FROM THE STRIPPER'S OUTPUT ───────────
#    The stripper above is pinned BYTE-IDENTICAL to the copy in `guard-shared-tree.sh` and this
#    file's own self-test asserts the parity, since #2871 fixed one copy and left the other. So a
#    diagnostic may not take state from inside it, however convenient that would be. It re-reads the
#    OUTPUT instead: the only heredoc bodies still standing in `cmd_nohere` are the ones the stripper
#    KEPT, which are exactly the ones an interpreter reads as a program. Splitting on those spans
#    recovers the same partition, and changes nothing the guard decides, because every rule below
#    still reads `cmd_nohere` whole.
_hd_kept=""
cmd_outside=""
_sp_rest="$cmd_nohere"
while [[ "$_sp_rest" =~ $_hd_open ]]; do
  _sp_tok="${BASH_REMATCH[0]}"; _sp_w="${BASH_REMATCH[1]}"
  _sp_pre="${_sp_rest%%"$_sp_tok"*}"
  _sp_post="${_sp_rest#*"$_sp_tok"}"
  # No closer in the remainder means the stripper broke out fail-closed and left raw text; the
  # remainder is then command text, which is the statement this diagnostic can defend.
  if ! [[ "$_sp_post" =~ (^|[[:space:]])"$_sp_w"([[:space:]]|$) ]]; then
    break
  fi
  _sp_end="${BASH_REMATCH[0]}"
  _hd_kept="$_hd_kept${_sp_post%%"$_sp_end"*}"
  cmd_outside="$cmd_outside$_sp_pre "
  _sp_rest="${_sp_post#*"$_sp_end"}"
done
cmd_outside="$cmd_outside$_sp_rest"

# ── PROGRAM TEXT, WHICH IS THE ONLY TEXT THE READ ALLOWLIST MAY JUDGE ──────────────────────────
#    A guarded path can arrive in an interpreter command two ways, and they are not the same
#    evidence. As PROGRAM TEXT — a kept heredoc body, or a `-c` / `-e` payload — the hook reads
#    the very code that will touch the path. As an ARGUMENT to a script file, the hook reads a
#    path and nothing else: `node tools/ste-lint.mjs briefs/X-BRIEF.md` says what it opens only
#    inside a file this hook cannot see.
#
#    ⚠ SO THE INVERSION APPLIES TO PROGRAM TEXT ALONE, and the boundary is stated rather than
#    hidden. Failing closed over command text would deny every brief-reading tool in this repo on
#    its first use — the "allowlist keyed on the wrong axis" defect that
#    `capture-host/nights_index.py:97` records, which fails closed where nobody wants it. A script
#    file's write is this hook's blind spot before and after the inversion; the gate for it is the
#    tool's own tests.
#    ⚠ AND THE PAYLOAD IS EXTRACTED BY A TOKENIZER, NOT BY SPLITTING ON `;`. The first draft of
#    this block split `cmd_outside` on `;|&` with `tr` and kept the clauses naming an interpreter
#    and an inline flag. Measured 2026-10-26 against this hook's own self-test: five legs read
#    ALLOW where they must DENY, because `python3 -c "import pathlib; pathlib.Path(L)…"` carries a
#    `;` INSIDE ITS QUOTED PAYLOAD. The split cut the program in two — the flag in one half, the
#    guarded path in the other — and neither half satisfied both tests. The `node -e` legs passed
#    the whole time, so the suite looked like a verb-list gap rather than a splitter defect.
#    A quote-aware tokenizer is the only honest reader of a shell word.
#    ⚠ AND IT EMITS TWO LINES, BECAUSE A SECOND TOKENIZER WOULD BE A SECOND CHANCE TO DISAGREE
#    WITH THIS ONE. Line 1 is the inline program payload, as before. Line 2 is the interpreter's
#    own ARGUMENT LIST: every non-flag token after an interpreter name that the payload did not
#    consume. The argv arm in `looks_like_write` reads line 2, and `emit()` fills both.
_tok_out="$(printf '%s' "$cmd_outside" | awk '
  BEGIN { q = ""; tok = ""; want = 0; interp = 0; out = ""; argvout = "" }
  function emit() {
    if (tok == "") return
    if (want) { out = out " " tok; want = 0 }
    else if (tok ~ /^(python3?|node|perl|ruby|php)$/ || tok ~ /\/(python3?|node|perl|ruby|php)$/) interp = 1
    else if (interp && (tok == "--eval" || (tok ~ /^-[A-Za-z]*[ceE]$/ && length(tok) <= 4))) want = 1
    else if (interp && substr(tok, 1, 1) != "-") argvout = argvout " " tok
    tok = ""
  }
  {
    s = $0
    for (i = 1; i <= length(s); i++) {
      c = substr(s, i, 1)
      if (q != "") { if (c == q) q = ""; else tok = tok c; continue }
      if (c == "\047" || c == "\"") { q = c; continue }
      if (c == " " || c == "\t") { emit(); continue }
      if (c == ";" || c == "|" || c == "&" || c == "(" || c == ")") { emit(); interp = 0; want = 0; continue }
      tok = tok c
    }
    emit()
  }
  END { print out; print argvout }
')"
prog_text="$_hd_kept $(printf '%s\n' "$_tok_out" | sed -n 1p)"
argv_text="$(printf '%s\n' "$_tok_out" | sed -n 2p)"

write_shape=""
write_from_prog=""
looks_like_write() {
  # A RUN OF ≥3 '>' IS A CONFLICT MARKER, NOT A REDIRECT — strip those runs before the redirect
  # test. Measured 2026-09-02: `grep -n "<<<<<<<\|=======\|>>>>>>>" briefs/X.md`, i.e. the standard
  # way to find conflict hunks after a rebase, matched `>` followed by a guarded path and was denied
  # as a write. That is a READ, and it is the read a session performs while doing the very thing this
  # guard asks for (rebase onto the upstream edits). No shell redirect uses three '>' — `>` and `>>`
  # are the whole vocabulary — so removing longer runs cannot hide a real write.
  local probe
  probe="$(printf '%s' "$1" | sed 's/>\{3,\}//g')"
  if printf '%s' "$probe" | grep -qE "(>>?|\btee\b|\bcp\b|\bmv\b|\btruncate\b)[^|;&]*${GUARDED_RE}"; then
    write_shape='a redirect, tee, cp, mv or truncate standing in the same clause as the guarded path'
    return 0
  fi
  if printf '%s' "$1" | grep -qE '\bsed\b[^|;&]*(-[A-Za-z]*i\b|--in-place)'; then
    write_shape='an in-place sed'
    return 0
  fi
  # An in-place perl edits a file with no write verb in its program text — `perl -pi -e 's/a/b/'`
  # names the target as an ARGUMENT, so the read allowlist below never sees it and the sed arm's
  # vocabulary did not reach it. Same shape, same clause-adjacency test, one word apart.
  if printf '%s' "$1" | grep -qE '\bperl\b[^|;&]*-[A-Za-z]*i'; then
    write_shape='an in-place perl, which names its target as an argument'
    return 0
  fi
  # ── THE INTERPRETER ARM, INVERTED ─────────────────────────────────────────────────────────────
  #    Owner ruling 1 on board #1549. The enumeration this replaces tested five write verbs, and
  #    measured 2026-10-26 (board #1437, hatches cleared, one command per arm through the hook
  #    contract) FOUR ordinary write forms rewrote a stale guarded doc with both guards silent:
  #    `pathlib.Path(L).write_text(…)`, `shutil.copy(src, L)`, `os.replace(src, L)` and
  #    `require('fs').appendFileSync(L, …)`. The control stands in the same run — `writeFileSync`
  #    on the same path, same cwd, same staleness — and it denied. So the verb list alone was the
  #    difference, and an enumeration of write verbs cannot be complete.
  #
  #    🔴 THE DIRECTION IS THE WHOLE POINT. A guarded path in program text denies unless a form
  #    the allowlist RECOGNISES as a read stands beside it. A read this allowlist does not know
  #    becomes a DENIAL, and `CLAUDE_ALLOW_STALE_BRIEF=1` in command position is the way past it.
  #    The path still usually hides behind a variable here, so no adjacency test can run — which
  #    is why a verb list was reached for in the first place, and why the inversion rather than a
  #    longer list is what closes the class.
  if [ -n "$2" ] && printf '%s' "$2" | grep -qE "$GUARDED_RE"; then
    local verb scan
    # ── THE TARGET SCAN RUNS FIRST, AND IT IS THE ONLY THING HERE THAT CAN ANSWER "DATA" ─────────
    #    Residue 2026-10-26-a-guarded-path-written-as-data-reads-as-a-write-of-that-path. Before it,
    #    a guarded path ANYWHERE in program text denied as soon as any write verb stood anywhere
    #    else in the same program, so a script writing a note to a scratchpad was denied for quoting
    #    a brief inside the note. `WT_SCAN` reads each write form's TARGET SLOT instead, and the row
    #    called that impossible because the adjacency it imagined cannot see a path behind a
    #    variable. One level of literal resolution is what makes it possible: the scan resolves
    #    `L = "briefs/X-BRIEF.md"` and judges the resolved value, and a target it CANNOT resolve
    #    denies. So the variable case the row protects keeps denying, by the same rule.
    scan="$(printf '%s' "$2" | awk -v guarded="$(printf '%s' "$GUARDED_RE" | sed 's/\\/\\\\/g')" "$WT_SCAN" 2>/dev/null)"
    case "$scan" in
      "DENY "*) write_shape="${scan#DENY }"; write_from_prog=1; return 0 ;;
      "ALLOW "*) return 1 ;;
    esac
    # NOWRITE, or an awk that could not run: the rule that shipped before the scan, unchanged. The
    # scan can only SUBTRACT denials, never add one, so a box without awk keeps the old behaviour.
    verb="$(printf '%s' "$2" | grep -oE "$WRITE_VERB_RE" | head -1)"
    if [ -n "$verb" ]; then
      write_shape="an interpreter write verb, matched as \`$verb\`, which the target scan does not model"
      write_from_prog=1
      return 0
    fi
    # A read beside no write is the allowlist's one ALLOW. Anything else is a form nobody here
    # recognises, and the arm reports WHAT it could not classify rather than a verb it never saw.
    if ! printf '%s' "$2" | grep -qE "$READ_FORM_RE"; then
      write_shape='a guarded path in interpreter program text, reached by no form the read allowlist knows — the arm fails closed on an unknown form'
      write_from_prog=1
      return 0
    fi
  fi
  # ── THE ARGV ARM — THE TWO CHANNELS JOINED AT THE TARGET SLOT ─────────────────────────────────
  #    Residue 2026-10-28-a-guarded-path-reaching-a-program-through-argv-is-invisible-to-the-guard.
  #    `python3 - briefs/X-BRIEF.md <<PY ... open(sys.argv[1], 'w') ... PY` rewrites a stale guarded
  #    doc with every arm above silent. The redirect arm sees no redirect. The interpreter arm never
  #    runs at all, because its gate asks the PROGRAM TEXT for a guarded path, and here the path
  #    travelled in argv while the write stayed in the program. Each half alone reads as a read.
  #
  #    🔴 WHAT THIS ARM MUST NOT DO IS WIDEN THAT GATE TO THE COMMAND LINE. The gate's body fails
  #    closed on an unknown read form, so a command with EMPTY program text would reach it carrying
  #    no write and no read, and deny. `node tools/ste-lint.mjs briefs/X-BRIEF.md` is that command,
  #    and the design brief names the outcome: every brief-reading tool in this repo denied on its
  #    first use. So the join is the TARGET SLOT instead of a wider gate or a longer verb list. The
  #    scan already resolves each write form's target, already denies a target it cannot reduce to
  #    a literal, and already NAMES the expression it read. One question of that name — is the
  #    target an argument — plus a guarded path in the interpreter's own argument list is the whole
  #    evidence. Either half alone stays ALLOW, and all three tests below are required.
  #
  #    It leaves `write_from_prog` unset deliberately. The guarded path stands in the command text
  #    here, so the diagnostic's own candidate-set wording is the truthful one, and a `data_only`
  #    note about program text would describe the wrong channel.
  if [ -n "$3" ] && printf '%s' "$3" | grep -qE "$GUARDED_RE" &&
    [ -n "$(printf '%s' "$2" | tr -d '[:space:]')" ]; then
    local ascan
    ascan="$(printf '%s' "$2" | awk -v guarded="$(printf '%s' "$GUARDED_RE" | sed 's/\\/\\\\/g')" "$WT_SCAN" 2>/dev/null)"
    case "$ascan" in
      "DENY "*)
        if printf '%s' "${ascan#DENY }" | grep -qE "$ARGV_TARGET_RE"; then
          write_shape="a write whose target the program reads from its own arguments, beside a guarded path in the interpreter's argument list"
          return 0
        fi
        ;;
    esac
  fi
  return 1
}

cands=""
cand_src=""
if [ -n "$f" ]; then
  rel="${f#"$root"/}"
  case "$rel" in
    briefs/*.md | DOCS-INDEX.md) cands="$rel"; cand_src="the tool payload's own file_path, so the target is certain" ;;
    *) : ;;
  esac
elif looks_like_write "$cmd_nohere" "$prog_text" "$argv_text"; then
  cands="$(printf '%s' "$cmd_nohere" | grep -oE "$GUARDED_RE" | sort -u)"
  cand_src='every guarded-looking path in the command text, which is a candidate set and not a target'
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
# `data_only` survives the loop only while EVERY reporting path was read inside program text alone.
# One path standing in the command proper clears it, because that one is a target the reader can see.
data_only=""
# ⚠ KEYED ON THE ARM THAT FIRED, NOT ON ITS PROSE. This used to match the one shape string the
# interpreter arm could produce, so the target scan's own denials — the ones MOST likely to be a
# data mention — printed no warning at all. A flag the arm sets cannot drift from the prose.
[ -n "$write_from_prog" ] && data_only=1
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  # shellcheck disable=SC2086 # $_have_too is a deliberately word-split "--not <sha>" list
  missed="$(G log --oneline --no-decorate "$base"..origin/main $_have_too -- "$rel" 2>/dev/null)" || continue
  [ -z "$missed" ] && continue
  [ -z "$first" ] && first="$rel"
  n=$((n + $(printf '%s\n' "$missed" | grep -c .)))
  # WHERE this path was read. A literal match, never a pattern: a brief name carries dots and plus
  # signs, and a regex over it would report a neighbour.
  if [ -n "$f" ]; then
    where="named by the tool payload"
  elif printf '%s' "$cmd_outside" | grep -qF "$rel"; then
    data_only=""
    if printf '%s' "$_hd_kept" | grep -qF "$rel"; then
      where="read in the command text, and again inside a heredoc the shell hands to an interpreter"
    else
      where="read in the command text"
    fi
  elif printf '%s' "$_hd_kept" | grep -qF "$rel"; then
    where="read ONLY inside a heredoc the shell hands to an interpreter, where a path can be data"
  else
    where="read in the command text"
  fi
  report="$report
  $rel   ($where)
$(printf '%s\n' "$missed" | sed 's/^/    /')"
done <<EOF
$cands
EOF
[ -z "$first" ] && exit 0

cat >&2 <<EOF
BLOCKED: a guarded doc has moved on origin/main since your branch's base — $n commit(s) you do not have.
$report

WHY THIS COMMAND READS AS A WRITE: ${write_shape:-the tool payload names a guarded path directly}
WHERE THE CANDIDATES CAME FROM:    ${cand_src:-the tool payload}
${data_only:+
⚠ EVERY PATH ABOVE WAS READ INSIDE PROGRAM TEXT ALONE, never beside a write verb in the command. A
  program that writes somewhere else and merely NAMES a guarded doc reads the same way to this hook,
  because an interpreter takes its target from a variable that no text rule can resolve. If that is
  your case, this denial
  is the false positive logged as residue
  2026-10-26-a-guarded-path-written-as-data-reads-as-a-write-of-that-path, the narrowing is a call
  the owner holds, and the command-position hatch below is the way past it today.
}
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
