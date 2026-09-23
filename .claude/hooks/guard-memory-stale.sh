#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-memory-stale.sh — PreToolUse(Read|Edit|Write) + PostToolUse(Edit|Write) guard against
# SILENTLY OVERWRITING a per-project MEMORY file another session wrote.
#
# THE FAILURE (residue 2026-09-03-memory-dir-has-no-stale-guard). Every fleet session writes to
# `~/.claude/projects/<project>/memory/` as the same unix user. On 2026-09-03 one session wrote
# `bands-cannot-detect-blindness.md`; minutes later another session Wrote its own version to the
# same path, having never read it, and the body was REPLACED wholesale — while the MEMORY.md index
# line survived, so the ledger kept pointing at a file whose content had silently changed authors.
# No conflict, no gate, no symptom. The directory is NOT in git: there is no merge-base to compare
# against, no `git log` to reconstruct from and no recovery. `guard-stale-brief.sh` is the same
# failure one directory over, and it has a base to measure against; this one does not.
#
# THE CHECK — the stale-brief shape with the file's own MTIME standing in for the git base:
#   · Read of a memory file  ⇒ RECORD `<path> <mtime_ns>` in this session's ledger.
#   · Edit/Write of a memory file that EXISTS ⇒ DENY unless the ledger holds that path with the
#     file's CURRENT mtime: "never read it this session" and "it changed since you read it" are the
#     two ways an overwrite drops someone's work, and both are decidable from the ledger alone.
#   · PostToolUse after our own Edit/Write ⇒ re-record the new mtime, so the session can keep
#     editing what it just wrote without re-reading it.
#   · A Write to a path that does not exist yet ⇒ ALLOW (a new memory is not an overwrite).
#   The ledger lives beside the memory dir, NOT inside it (`<project>/.memory-guard/<session_id>`),
#   so nothing the memory system indexes is polluted.
#
# ⚠ §2b-bis APPLIES, AND HERE IT BITES HARDER THAN ANYWHERE ELSE. This is a Claude Code PreToolUse
#   hook wired through `.claude/settings.json`: it runs ONLY for a session whose checkout has pulled
#   the wiring and this script. The memory directory is shared by EVERY session of the project —
#   including sessions running from a checkout that has not pulled it, and any other client — and
#   those sessions are UNGATED by this file. Because the directory is outside git, an overwrite by
#   such a session is undetectable after the fact; there is no CI counterpart to this guard. The only
#   agent-neutral protection is the harness's own read-before-Write rule, which does not cover the
#   read-then-someone-else-writes-then-you-write race this closes. Say that in any design that
#   leans on this guard; do not describe the memory dir as "protected".
#
# ⚠ FAILS OPEN on every leg where it cannot know: `jq` missing (ANNOUNCED once per session — see the
#   block at the jq test, and note that the sibling guards' fail-open reasoning does NOT transfer to
#   this directory), no session id in the payload, a path outside a `.claude/projects/*/memory/`
#   directory. Each fail-open leg is pinned in the self-test beside the DENY it differs from by one
#   property.
#
# ⚠ THIS GUARD CLOSES OVERWRITE, NOT CONVERGENCE — and the difference is not a corner case.
#   It catches one session REPLACING another's body, which is what it was built for. It cannot catch
#   two sessions INDEPENDENTLY APPENDING THE SAME FINDING: both reads are legitimate, both writes are
#   additions, and the mtime moves exactly as ordinary sequential work does. Measured 2026-09-22 while
#   this very follow-up was being written — two sessions wrote the same correction into
#   `stale-root-is-the-default.md` minutes apart and the file carried BOTH, at line 33 and line 87,
#   with no conflict and no signal. Nothing was lost (which is why duplication is the cheaper failure)
#   but the file decays, and it decays invisibly for the same reason the overwrite did.
#   The mitigation is human: the second writer notices and prunes. Do not read "the memory dir is
#   guarded" as covering this.
#
# ⚠ A MOVE IS REPORTED ONCE, BY DESIGN — and a later exit 0 means "already told you", NOT "nothing
#   happened". The sequence is: post #1 finds no snapshot and writes one (silent — there is no
#   baseline, so no finding is possible); a file then moves with no Read recorded; post #2 exits 2 and
#   names it, AND RE-SNAPSHOTS; post #3 exits 0 because the move is now the baseline. Repeating the
#   same finding on every subsequent command would be the noise that gets a guard ripped out. The
#   cost of the choice is real and is stated here rather than discovered: a session that misses or
#   dismisses the one report gets no second chance, on a directory that keeps no other record.
#   ⚠ AND A SECOND MOVE IN THE SAME COMMAND FOLDS INTO THE FIRST REPORT. The report names every
#   file that pass found, and re-snapshots all of them — so a command that moves two files reports
#   both at once, and the NEXT command exits 0. Not a defect, but a later exit 0 must not be read as
#   "only one thing moved": it means "nothing has moved since the last report", which is a different
#   claim (Wren, 2026-09-22, live on the box).
#
# ── WHY THERE ARE TWO ARMS, AND WHY THE SECOND ONE IS THE REAL GUARD ────────────────────────────
#   This shipped with `Edit|Write` + `Read` only, and its header said a Bash-side write "is NOT seen".
#   Measured 2026-09-22: a fleet session runs under an instruction to PREFER Bash for file edits, so
#   every memory file it wrote that day went through a heredoc and this guard saw NONE of them — the
#   guard covered that session at 0 %. A caveat beside a guard that reads as enforcement is not a
#   limitation, it is a hole, so it is replaced by wiring rather than kept next to it.
#
#   ⚠ AND A `Bash` PRE-HOOK CANNOT CLOSE IT, because it can only read the COMMAND TEXT. Of the three
#   forms that session actually uses, only two put the path there:
#       cat > /…/memory/foo.md <<'EOF'        → visible
#       sed -i 's/…/…/' /…/memory/MEMORY.md   → visible
#       python3 - <<'PY' … open(p,'w') …      → NOT visible when p is computed
#   The third is not exotic: a heredoc-fed program is how you keep bash from eating backticks out of
#   prose. `python3 patch.py`, `$EDITOR`, a variable path and a `tee` behind a pipe are each
#   undecidable from the string, so a pre-hook tested with a `cat >` case would go green while the
#   population that actually writes these files walks past it — the vacuous plant.
#
#   So: PREVENTION is best-effort on the two parseable forms (the pre-Bash arm below), and DETECTION
#   ⚠ "BEST-EFFORT" IS TRUE AND UNINFORMATIVE, so here is exactly what it does not see: prevention
#   matches an ABSOLUTE `…/.claude/projects/*/memory/*` IN THE COMMAND TEXT. So
#       cd <memdir> && sed -i 's/…/…/' foo.md
#   — prevention's own named form, written after a `cd` — carries only a bare filename and walks
#   straight past it. Measured 2026-09-22 (Wren, live on a checkout carrying this guard): they wrote
#   that form by reflex, which is the point — it is the natural way to type the command, not an
#   exotic evasion. DETECTION fired on it, because detection never looks at the command.
#   ⚠ AND THE MATCHING IS DELIBERATELY NOT EXTENDED TO COVER IT (ruling, 2026-09-22). Matching a
#   bare `*.md` after a `cd` buys partial coverage at the price of making prevention LOOK complete
#   while staying partial: a `cd` in an EARLIER command, a `pushd`, a variable, a subshell, a
#   `$HOME`-relative path or a symlink each defeats it again, and each extension invites the next
#   reader to assume the gap is closed. A partial mechanism must not be dressed as a complete one.
#   The boundary is stated instead — here, and in the denial text where it is actually read — so
#   nobody infers protection they do not have.
#   is the complete half (the post-Bash arm). Detection ignores the command entirely and reads a
#   PROPERTY OF THE RESULT — a memory file whose mtime moved during a command, in a session that
#   never read it — which no write form can evade. That is CLAUDE.md §2b-bis's own argument one level
#   down: prevention is coupled to what the tool loop can see; detection is not.
#
#   ⚠ DETECTION CANNOT ATTRIBUTE. It says a file moved under this session's command and that this
#   session had not read it; it does NOT prove this session wrote it (another session may have, in
#   the same instant). The message says so. It also cannot report on the FIRST invocation of a
#   session, which has no baseline — the snapshot is written then, silently, and the limit is stated
#   rather than papered over.
#
# ⚠ THE WINDOW — what the excuse costs, stated because it is NOT closable ────────────────────────
#   The POST arm forgives the exact path the PRE arm just allowed, once. A peer overwriting THAT path
#   between the two calls is forgiven with it. That is not a weakness of the patch — it is the
#   boundary of what an mtime can decide: after a write the pre arm allowed, your bytes and a peer's
#   bytes produce the SAME observable, a newer mtime on a path you had read. Separating them needs
#   CONTENT, which is the limit this arm's own "DETECTION CANNOT ATTRIBUTE" already declares. A rule
#   that appeared to close the window would be closing it by assumption.
#
#   So it is bounded on the axis that IS decidable — time and path, not identity:
#     · ONE command   — spent by the very next post-check, whether or not anything moved
#     · ONE path      — a peer touching a DIFFERENT memory file in that window still reports
#     · ONLY a path the pre arm actually allowed — a DENIED command leaves no licence behind
#     · ONLY the parseable forms — an unparseable write (a heredoc-fed interpreter) never reaches the
#       pre arm's allow, so it writes no expectation and still reports. That is the population the
#       POST arm was built for, and the excuse does not touch it.
#   Each of those four is a self-test leg with a positive control, because an excuse that reaches too
#   far is this guard with its finding removed, and that failure is silent.
#
#   The trade it buys: a 100 % false-positive rate on every sanctioned edit, gone. Before this, the
#   real report and the cry-wolf printed IDENTICALLY — so the case the arm exists for was the one a
#   session learns to scroll past. A bounded blind window beats a finding nobody reads.
#
# Escape hatch: CLAUDE_ALLOW_STALE_MEMORY=1 — EXPORTED (an Edit/Write carries no command text, so an
# inline prefix cannot reach this process). Use it when you have read the file in another session
# and are deliberately writing over it; say so in the memory's own body.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
[ "${CLAUDE_ALLOW_STALE_MEMORY:-}" = "1" ] && exit 0
payload="$(cat 2>/dev/null)" || exit 0
# ⚡ CHEAP REJECT FIRST — this hook rides Read, the hottest tool in the loop, and almost every Read is
# not a memory file. A substring test on the RAW payload costs nothing and skips the jq fork for all
# of them; only a payload that could name a memory path pays for parsing. (Measured: 5.2 ms → 1.4 ms
# per non-memory Read.) It can only over-admit — a payload mentioning the string still goes through
# the real path check below — so it cannot turn a DENY into an ALLOW.
# ⚠ THE REJECT MUST NOT APPLY TO THE POST PHASE, and getting that wrong is this file's own vacuity
#   shape: DETECTION reads the directory, not the command, so a post payload carrying no memory path
#   (`true`, `npm test`, anything) is exactly the case it exists for. Measured while writing the
#   test: with the reject unconditional, the python-heredoc plant passed prevention (correctly, it is
#   invisible there) and then passed detection too — a guard green on the one population it was added
#   for. The phase is argv, so this costs nothing.
case "${1:-pre}" in
  post) : ;;
  *) case "$payload" in *"/memory/"*) : ;; *) exit 0 ;; esac ;;
esac
# ── WITHOUT jq THIS GUARD IS INERT, AND IT SAYS SO ONCE ─────────────────────────────────────────
#    It still FAILS OPEN — a hook that errors on every tool call breaks the session, which is worse
#    than the gap. What changes is the silence.
#    ⚠ AND THE SIBLINGS' REASONING DOES NOT TRANSFER HERE. `guard-format.sh` fails open where Biome
#    cannot run because `biome` is a REQUIRED check: it degrades to an existing safety net. THIS
#    directory has none — it is not in git, no gate reads it, no CI job can see it, and this hook is
#    the only thing watching. So the same behaviour degrades to NOTHING, and doing that without a word
#    is the fail-open-and-say-nothing shape. Do not re-inherit the other guards' argument here.
#    Announced ONCE PER SESSION, never per call (a line on every call is how a guard gets ripped out),
#    and only on the pre phase of a WRITE — never on Read, which is the hot path. `$CLAUDE_CODE_SESSION_ID`
#    is readable WITHOUT jq, which is what makes the marker possible at all; without it the notice is
#    once per boot, which is still not silence.
if ! command -v jq >/dev/null 2>&1; then
  # Never on Read — the hot path. The tool name cannot be PARSED here (that is what jq was for), so
  # this is a raw substring test on the payload. It can only OVER-match, and over-matching costs a
  # suppressed notice, never a suppressed denial: this block does not deny anything.
  case "$payload" in *'"tool_name":"Read"'*) exit 0 ;; esac
  if [ "${1:-pre}" = "pre" ]; then
    _sid_env="${CLAUDE_CODE_SESSION_ID:-nosession}"
    case "$_sid_env" in *[!A-Za-z0-9._-]*) _sid_env=nosession ;; esac
    # Named for what it is, and session-scoped: /tmp here is a 30 GB tmpfs and §4c's orphan sweep is
    # a live concern even for one tiny file.
    _inert_marker="${TMPDIR:-/tmp}/tepna-memory-guard-inert.$_sid_env"
    if [ ! -f "$_inert_marker" ]; then
      : > "$_inert_marker" 2>/dev/null
      cat >&2 <<'EOF0'
⚠ THE MEMORY GUARD IS INERT THIS SESSION: `jq` is not on PATH, so it cannot read a tool payload and
is allowing every memory write unchecked. It is failing OPEN deliberately — erroring on every tool
call would be worse — but unlike the format/ruff guards, NOTHING backstops this one: the memory
directory is not in git, no CI job reads it, and this hook is the only thing watching. Until `jq` is
available, read a memory file before you overwrite it; nothing else will tell you that someone else
already did. (Shown once per session.)
EOF0
    fi
  fi
  exit 0
fi
f="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
sid="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"
[ -z "$sid" ] && sid="${CLAUDE_CODE_SESSION_ID:-}"
[ -z "$sid" ] && exit 0
case "$sid" in *[!A-Za-z0-9._-]*) exit 0 ;; esac
phase="${1:-pre}"   # `pre` (PreToolUse) or `post` (PostToolUse) — settings.json passes it
mtime_of() { stat -c '%.9Y' "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo ''; }   # ns precision where GNU stat has it

# ── THE MEMORY DIRECTORIES THIS BOX HAS ────────────────────────────────────────────────────────
#    The canonical location is the scope pattern itself, so the glob IS the population — every
#    project slug on the box, not a list anybody maintains (the box's own `-opt-tepna` slug is in
#    scope by construction, and the self-test pins a second slug as evidence rather than argument).
mem_dirs() {
  local d
  for d in "$HOME"/.claude/projects/*/memory; do [ -d "$d" ] && printf '%s\n' "$d"; done
}

if [ "$tool" = "Bash" ]; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
  # ── POST-Bash · DETECTION. The command is IGNORED: a file that moved is a property of the result.
  if [ "$phase" = "post" ]; then
    # ⚠ TWO PROCESSES PER DIRECTORY, NOT TWO PER FILE. The first cut forked `stat` and `grep` per
    #   memory file and cost **3277 ms per Bash command** over the 511 files rig-x870 holds — a guard
    #   that expensive on the hottest tool is a guard somebody rips out, which is the same outcome as
    #   not having one. `find -printf` reads every mtime in one process and `awk` does the compare in
    #   another. Measured after, ON TWO MACHINES, because a figure taken in one place is an anecdote:
    #       rig-x870  43.6 ms  over 511 memory files
    #       vigil     48   ms  over 320 memory files   (Wren, 2026-09-22, warm, 5 calls)
    #   60 % more files for 9 % less time, so the cost is NOT file-count-dominated — which is what
    #   makes the number travel to a third machine instead of being true only where it was taken.
    #   ⚠ THIS COMMENT SAID "single-digit ms", A FIGURE NOBODY EVER MEASURED. The PR that landed this
    #   arm carried 43.6 ms correctly in its body while the header asserted an order of magnitude less,
    #   inside a sentence reading "Cost is a property of a hook, not an afterthought". An assertion
    #   where a measurement was available, in the artifact written to argue against exactly that.
    for memdir in $(mem_dirs); do
      proj="${memdir%/memory}"
      snap="$proj/.memory-guard/$sid.snap"
      ledger="$proj/.memory-guard/$sid"
      # ⚠ A MISSING LEDGER IS A FILE awk CANNOT OPEN, and it fails the whole program — the first cut
      #   passed the path unconditionally and every session that had read nothing got a silent awk
      #   error instead of a finding. The `-f` test is the difference between "no reads recorded" and
      #   "the comparison did not run".
      [ -f "$ledger" ] || ledger=/dev/null
      # ⚠ THE PRE ARM'S OWN ALLOW, EXCUSED ONCE. Measured 2026-09-23 (Wren found it; Kestrel and I
      #   reproduced it independently, each with a control): after a write this hook's PRE arm ALLOWED,
      #   the POST arm reported anyway — 100 % of the time, by construction. A `Read` necessarily
      #   records the PRE-write mtime, so once the write lands the ledger can never hold the current
      #   one and `rd[$1]!=$2` holds for every sanctioned edit. The false report and the real one print
      #   IDENTICALLY, which makes the case this arm exists for the one people learn to scroll past.
      #   So the PRE arm leaves the paths it allowed here and the POST arm forgives exactly those,
      #   exactly once — see THE WINDOW in the header for what that costs and why it is not closable.
      pending="$proj/.memory-guard/$sid.pending"
      [ -f "$pending" ] || pending=/dev/null
      # `%T@` (float seconds) — `%.9T@` is not a find format and printed a truncated integer, which
      # compares equal across writes inside the same second. Caught by the plant, not by review.
      cur="$(find "$memdir" -maxdepth 1 -type f -printf '%p\t%T@\n' 2>/dev/null | sort)"
      [ -n "$cur" ] || continue
      if [ -f "$snap" ]; then
        # moved := in the snapshot with a DIFFERENT mtime, and not recorded in the read-ledger at the
        # CURRENT mtime (that last case is this session's own accounted write). A file absent from the
        # snapshot has no baseline and is never a finding.
        moved="$(awk -F'\t' '
          FILENAME==ARGV[1] { was[$1]=$2; next }
          FILENAME==ARGV[2] { rd[$1]=$2; next }
          FILENAME==ARGV[3] { pend[$1]=1; next }
          { if (($1 in was) && was[$1]!=$2 && rd[$1]!=$2 && !($1 in pend)) printf "  %s   %s → %s\n", $1, was[$1], $2 }
        ' "$snap" "$ledger" "$pending" /dev/stdin <<EOF4
$cur
EOF4
)"
        if [ -n "$moved" ]; then
          mkdir -p "$proj/.memory-guard" 2>/dev/null && printf '%s\n' "$cur" > "$snap" 2>/dev/null
          first="$(printf '%s' "$moved" | head -1 | awk '{print $1}')"
          cat >&2 <<EOF5
⚠ A MEMORY FILE MOVED during that command, and this session had not read it:

$moved

The memory directory is shared by every fleet session as one unix user and is NOT in git, so an
overwrite there leaves no conflict, no gate and no symptom. This is DETECTION, not attribution: the
file changed while your command ran and you had not read it — another session may have written it in
the same instant. If it was your command, Read the file and check the other author's text survived.

    Read  $first
EOF5
          exit 2
        fi
      fi
      # ONCE means once: the expectation is spent whether or not anything moved, so a command that
      # was allowed but wrote nothing cannot leave a licence lying around for the next one.
      rm -f "$proj/.memory-guard/$sid.pending" 2>/dev/null
      mkdir -p "$proj/.memory-guard" 2>/dev/null && printf '%s\n' "$cur" > "$snap" 2>/dev/null
    done
    exit 0
  fi
  # ── PRE-Bash · PREVENTION, best effort on the two parseable forms. ──────────────────────────────
  [ -z "$cmd" ] && exit 0
  MEM_RE='[^ "'"'"';|&)]*/\.claude/projects/[^ "'"'"';|&)]*/memory/[^ "'"'"';|&)]*'
  # A RUN OF ≥3 '>' IS A CONFLICT MARKER, NOT A REDIRECT (guard-stale-brief.sh's lesson): a
  # `grep -n ">>>>>>>" <file>` is a READ, and a guard that denies its own remedy is worse than the gap.
  probe="$(printf '%s' "$cmd" | sed 's/>\{3,\}//g')"
  write_shaped=1
  printf '%s' "$probe" | grep -qE "(>>?|\btee\b|\bcp\b|\bmv\b|\btruncate\b)[^|;&]*${MEM_RE}" && write_shaped=0
  printf '%s' "$cmd" | grep -qE '\bsed\b[^|;&]*(-[A-Za-z]*i\b|--in-place)' && printf '%s' "$cmd" | grep -qE "$MEM_RE" && write_shaped=0
  [ "$write_shaped" = "0" ] || exit 0
  # Collected, not written yet: a command DENIED on its second path must not leave an expectation
  # behind for its first — that licence would outlive a command that never ran.
  _allowed=''
  for cand in $(printf '%s' "$cmd" | grep -oE "$MEM_RE" | sort -u); do
    [ -f "$cand" ] || continue                                   # a NEW memory file is not an overwrite
    memdir="${cand%/memory/*}/memory"
    proj="${cand%/memory/*}"
    ledger="$proj/.memory-guard/$sid"
    now_mt="$(mtime_of "$cand")"
    seen_mt=""
    [ -f "$ledger" ] && seen_mt="$(grep -F -- "$cand	" "$ledger" 2>/dev/null | tail -1 | cut -f2)"
    if [ -n "$seen_mt" ] && [ "$seen_mt" = "$now_mt" ]; then
      _allowed="$_allowed$proj	$cand
"
      continue
    fi
    if [ -z "$seen_mt" ]; then
      why="this session has NOT read it (no Read recorded for it in this session's ledger)"
    else
      why="it CHANGED since this session read it (read at mtime $seen_mt, now $now_mt — another session wrote it)"
    fi
    cat >&2 <<EOF6
BLOCKED: a Bash write to memory '${cand#"$memdir"/}' — $why.

The command is write-shaped at a memory path (a redirect, a tee/cp/mv, or an in-place sed). Read the
file first, then edit it so the other author's text survives:

    Read  $cand

If you have read it in another session and are deliberately writing over it, say so in the file and:

    export CLAUDE_ALLOW_STALE_MEMORY=1

WHAT THIS CHECK DOES NOT SEE: it matches an ABSOLUTE memory path in the command text, so the same
edit written after a 'cd' into the memory directory (cd <memdir> && sed -i ... foo.md) carries only a
bare filename and walks past it. That is not a hole to use: the POST-command check catches it, because
it ignores the command and reads the directory. Do not infer from this denial that an unmatched form
is an unwatched one.
EOF6
    exit 2
  done
  # The whole command is allowed, so the expectation is safe to leave: one line per (project, path),
  # spent by the very next post-check. Written HERE and not in the loop for the reason above.
  if [ -n "$_allowed" ]; then
    printf '%s' "$_allowed" | while IFS='	' read -r _p _c; do
      [ -n "$_p" ] || continue
      mkdir -p "$_p/.memory-guard" 2>/dev/null && printf '%s\n' "$_c" >> "$_p/.memory-guard/$sid.pending" 2>/dev/null
    done
  fi
  exit 0
fi

[ -z "$f" ] && exit 0

# ── SCOPE: <anything>/.claude/projects/<project>/memory/<file> — the memory dir of ANY project. ──
case "$f" in
  */.claude/projects/*/memory/*) : ;;
  *) exit 0 ;;
esac
memdir="${f%/memory/*}/memory"
proj="${f%/memory/*}"
ledger_dir="$proj/.memory-guard"
ledger="$ledger_dir/$sid"
record() { # record <path> <mtime>
  mkdir -p "$ledger_dir" 2>/dev/null || return 0
  { [ -f "$ledger" ] && grep -v -F -- "$1	" "$ledger"; printf '%s\t%s\n' "$1" "$2"; } > "$ledger.tmp" 2>/dev/null && mv -f "$ledger.tmp" "$ledger" 2>/dev/null
  return 0
}

case "$tool" in
  Read)
    [ -f "$f" ] && record "$f" "$(mtime_of "$f")"
    exit 0 ;;
  Edit|Write|MultiEdit)
    if [ "$phase" = "post" ]; then
      [ -f "$f" ] && record "$f" "$(mtime_of "$f")"
      exit 0
    fi ;;
  *) exit 0 ;;
esac

# ── PreToolUse Edit/Write on a memory file ──────────────────────────────────────────────────────
[ -f "$f" ] || exit 0                       # a NEW memory is not an overwrite
now_mt="$(mtime_of "$f")"
seen_mt=""
[ -f "$ledger" ] && seen_mt="$(grep -F -- "$f	" "$ledger" 2>/dev/null | tail -1 | cut -f2)"
if [ -n "$seen_mt" ] && [ "$seen_mt" = "$now_mt" ]; then exit 0; fi
rel="${f#"$memdir"/}"
if [ -z "$seen_mt" ]; then
  why="this session has NOT read it (no Read recorded for it in this session's ledger)"
else
  why="it CHANGED since this session read it (read at mtime $seen_mt, now $now_mt — another session wrote it)"
fi
cat >&2 <<EOF2
BLOCKED: overwriting memory '$rel' — $why.

The memory directory is shared by every fleet session as one unix user, is NOT in git, and an
overwrite there leaves no conflict, no gate and no symptom (residue
2026-09-03-memory-dir-has-no-stale-guard: a body was replaced wholesale while its MEMORY.md index
line survived). Read the file first, then Edit it so the other author's text survives:

    Read  $f

If you have read it in another session and are deliberately writing over it, say so in the file and:

    export CLAUDE_ALLOW_STALE_MEMORY=1
EOF2
exit 2
