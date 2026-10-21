#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# guard-stale-ledger.test.sh — self-test for guard-stale-ledger.sh.
#
# Builds a THROWAWAY repo with the real divergence: a ledger row closed on
# `origin/main` that the checkout still reads as OPEN. The hook is driven exactly
# as the harness drives it, with the tool-call JSON on stdin.
#
# A guard nobody has watched fail is not a guard, so every DENY below is paired
# with an ALLOW that differs in ONE property. Two of the legs are here because
# they caught defects in this hook before it was wired:
#
#   · THE ESCAPED-PIPE LEG. The first extractor split rows on a bare `|`, so the
#     46 ledger lines carrying `\|` got the wrong field count and fell out of the
#     population. A stale state on one of those rows would have been allowed.
#     The leg makes such a row the ONLY disagreement, so an extractor that drops
#     them scores ALLOW where the fixture says DENY.
#   · THE HEADER LEG. A bare six-cell test admits the table's own header row,
#     which is how the extractor counted 714 rows against the pickup tool's 713.
#     The leg moves the header text alone and demands silence.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# THE HOOK MUST NOT INHERIT THE RUNNING SESSION'S HATCH. `CLAUDE_ALLOW_STALE_LEDGER=1` is documented in
# command position, and that is also the position which EXPORTS it to every child — `npm run
# check` is a child, so every DENY leg below would score ALLOW and the gate would report a
# disarmed instrument as broken legs. Measured 2026-10-21: 9 of the 11 hatch-reading
# self-tests moved from PASS to RED with their own hatch exported. Gated by
# the suite group `every hatch-reading hook has a self-test its own hatch cannot disarm`, whose
# population is `.claude/hooks/` itself. A leg that WANTS the hatch sets it inline, per leg,
# which an `unset` at the top of the file does not touch.
unset CLAUDE_ALLOW_STALE_LEDGER
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-stale-ledger.sh"
# ⚠ THE WRITER-FATE PAYLOAD IS SIZED FROM THE KERNEL, NOT FROM A ROUND NUMBER — the derivation
# and the measurement behind it are in `guard-stale-brief.test.sh`, and `--probe-bytes` is the one
# authority. A size that cannot be derived refuses: it is a leg that would examine nothing.
_PROBE_TOOL="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/tools/hook-contract.mjs"
_PROBE_BYTES="$(node "$_PROBE_TOOL" --probe-bytes 2>/dev/null)"
case "$_PROBE_BYTES" in ''|*[!0-9]*) printf '  REFUSE  the writer-fate payload size could not be derived (%s --probe-bytes)\n' "$_PROBE_TOOL" >&2; exit 2 ;; esac

fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

UP="$TMP/upstream"; SEED="$TMP/seed"; STALE="$TMP/stale"; CUR="$TMP/current"
git init -q --bare "$UP"
git clone -q "$UP" "$SEED" 2>/dev/null
cd "$SEED" || exit 1
git config user.email t@t; git config user.name t
mkdir -p briefs tools

# ── the BASE ledger: alpha OPEN. `bravo` carries an escaped pipe in its defect cell, which is the
#    ledger's own convention for a literal `|`; `charlie` never moves and holds the differ count to
#    exactly the row each leg is about.
write_ledger() { # write_ledger <alpha-state> <bravo-state> <charlie-state> <header-cell> <malformed-state>
  cat > briefs/RESIDUE.md <<LED
# Residue

Prose above the table. One row per verified defect, appended and closed, never edited.

| $4 | logged | source | defect | evidence | state |
|---|---|---|---|---|---|
| 2026-10-01-alpha | 2026-10-01 | #1 | a defect | an evidence | $1 |
| 2026-10-02-bravo | 2026-10-02 | #2 | reads \`a \| b\` as two cells | an evidence | $2 |
| 2026-10-03-charlie | 2026-10-03 | #3 | a third defect | an evidence | $3 |
|  | 2026-10-05 | #5 | a malformed row with no key at all | an evidence | ${5:-OPEN} |
| --- | 2026-10-06 | #6 | a malformed row whose key is dashes | an evidence | ${5:-OPEN} |
LED
}
write_ledger OPEN 'fixed #9002' OPEN 'key'
printf 'not the ledger\n' > briefs/OTHER-BRIEF.md
printf 'console.log(1)\n' > tools/residue-ids.mjs
git add -A >/dev/null; git commit -qm base
git branch -M main; git push -q origin main 2>/dev/null

# ⚠ THE BARE REPO'S HEAD STILL POINTS AT `master`, which no push created. A clone then checks out
#   NOTHING and every leg below reads a missing file as the hook failing open — six DENYs scored
#   ALLOW on the first run of this file for exactly that reason.
git -C "$UP" symbolic-ref HEAD refs/heads/main
git clone -q "$UP" "$STALE" 2>/dev/null
git clone -q "$UP" "$CUR" 2>/dev/null

# ── main advances: alpha is closed by the PR that fixed it. This is the real mechanism — the
#    checkout's own file is untouched and still says OPEN.
write_ledger 'fixed #9001' 'fixed #9002' OPEN 'key'
git add briefs/RESIDUE.md >/dev/null; git commit -qm 'close alpha'; git push -q origin main 2>/dev/null
REF_LEDGER="$(cat briefs/RESIDUE.md)"

git -C "$STALE" fetch -q origin                 # remote-tracking ref moves, the worktree does not
git -C "$CUR" fetch -q origin
git -C "$CUR" merge -q --ff-only origin/main    # the current checkout: disk == ref

# ── drivers ───────────────────────────────────────────────────────────────────
run() { # run <dir> <json> [env-assignment…]
  local dir="$1" json="$2"; shift 2
  ( cd "$dir" && printf '%s' "$json" | env "$@" bash "$H" >/dev/null 2>&1; echo "$?" )
}
verdict() { [ "$1" = 2 ] && echo DENY || echo ALLOW; }
expect() { # expect <want> <label> <dir> <json> [env…]
  local want="$1" label="$2" dir="$3" json="$4"; shift 4
  local got; got="$(verdict "$(run "$dir" "$json" "$@")")"
  if [ "$got" = "$want" ]; then printf '  ok    %-62s %s\n' "$label" "$got"
  else printf '  FAIL  %-62s got %s, want %s\n' "$label" "$got" "$want"; fail=$((fail+1)); fi
}
cmdj() { jq -nc --arg c "$1" '{tool_input:{command:$c}}'; }
pathj() { jq -nc --arg p "$1" '{tool_input:{file_path:$p}}'; }
grepj() { jq -nc --arg p "$1" '{tool_input:{pattern:"OPEN",path:$p}}'; }

READ_CMD="grep -n '| OPEN |' briefs/RESIDUE.md"

echo "### the divergence it exists to catch"
expect DENY  "a row OPEN on disk and closed on the ref"        "$STALE" "$(cmdj "$READ_CMD")"
expect DENY  "…a Read of the same file, by absolute path"      "$STALE" "$(pathj "$STALE/briefs/RESIDUE.md")"
expect DENY  "…a Grep whose path names the file"               "$STALE" "$(grepj "$STALE/briefs/RESIDUE.md")"
expect DENY  "an exempt clause beside a stale read"            "$STALE" "$(cmdj "git show origin/main:briefs/RESIDUE.md > /tmp/x && grep OPEN briefs/RESIDUE.md")"
expect DENY  "the hatch NAMED but not in command position"     "$STALE" "$(cmdj "echo CLAUDE_ALLOW_STALE_LEDGER=1 ; grep OPEN briefs/RESIDUE.md")"
expect DENY  "a cd into the stale tree from elsewhere"          "$CUR"  "$(cmdj "cd $STALE && $READ_CMD")"

echo
echo "### the paired ALLOWs — each differs in exactly ONE property"
expect ALLOW "the same read in a CURRENT checkout"             "$CUR"   "$(cmdj "$READ_CMD")"
expect ALLOW "…a Read there, by absolute path"                 "$CUR"   "$(pathj "$CUR/briefs/RESIDUE.md")"
expect ALLOW "reading the ref itself — the printed remedy"      "$STALE" "$(cmdj "git show origin/main:briefs/RESIDUE.md | grep '| OPEN |'")"
expect ALLOW "the documented pickup tool"                      "$STALE" "$(cmdj "node tools/residue-ids.mjs --open")"
expect ALLOW "git log on the path — history, not state"        "$STALE" "$(cmdj "git log --oneline -- briefs/RESIDUE.md")"
expect ALLOW "a command naming a DIFFERENT file in briefs/"    "$STALE" "$(cmdj "grep -n OPEN briefs/OTHER-BRIEF.md")"
expect ALLOW "a heredoc body naming the ledger is DATA"        "$STALE" "$(cmdj "cat > /tmp/note.md <<'X'
see briefs/RESIDUE.md for the row
X")"
expect ALLOW "the hatch in command position"                   "$STALE" "$(cmdj "CLAUDE_ALLOW_STALE_LEDGER=1 $READ_CMD")"
expect ALLOW "the hatch exported — the only form a Read sees"  "$STALE" "$(pathj "$STALE/briefs/RESIDUE.md")" CLAUDE_ALLOW_STALE_LEDGER=1
expect ALLOW "a Grep whose path is a DIRECTORY, not the file"  "$STALE" "$(grepj "$STALE/briefs")"

echo
echo "### the population: the two legs that caught this hook's own defects"
write_ledger 'fixed #9001' OPEN OPEN 'key' 2>/dev/null
cp briefs/RESIDUE.md "$STALE/briefs/RESIDUE.md"
expect DENY  "the ONLY stale row is one carrying an escaped pipe" "$STALE" "$(cmdj "$READ_CMD")"
# ⚠ IT IS THE HEADER'S LAST CELL THAT MUST MOVE. Renaming its FIRST cell makes it a key present on
#   one side only, which the hook ignores for its own reason, so the leg passed with the shape test
#   deleted — measured, mutant M2 survived it. Moving `state` to `status` keeps the key equal on both
#   sides and the state unequal, which is a stale row to anything that admits the header as a row.
printf '%s\n' "$REF_LEDGER" | sed 's/| evidence | state |/| evidence | status |/' > "$STALE/briefs/RESIDUE.md"
printf 'a sentence added below the table.\n' >> "$STALE/briefs/RESIDUE.md"
expect ALLOW "the header's own state cell moved, no row did"      "$STALE" "$(cmdj "$READ_CMD")"
printf '%s\n' "$REF_LEDGER" | sed 's/^|---|---|---|---|---|---|$/|:---|---|---|---|---|---:|/' > "$STALE/briefs/RESIDUE.md"
expect ALLOW "the separator row's alignment markers moved"        "$STALE" "$(cmdj "$READ_CMD")"
write_ledger 'fixed #9001' 'fixed #9002' OPEN 'key' 'fixed #9099'
cp briefs/RESIDUE.md "$STALE/briefs/RESIDUE.md"
expect ALLOW "only the two MALFORMED rows moved — neither is a row"  "$STALE" "$(cmdj "$READ_CMD")"

echo
echo "### a key on one side only is not a stale state"
{ printf '%s\n' "$REF_LEDGER"; printf '| 2026-10-04-delta | 2026-10-04 | #4 | mine | this session | OPEN |\n'; } > "$STALE/briefs/RESIDUE.md"
expect ALLOW "a row appended here and not yet on the ref"      "$STALE" "$(cmdj "$READ_CMD")"
printf '%s\n' "$REF_LEDGER" | grep -v charlie > "$STALE/briefs/RESIDUE.md"
expect ALLOW "a row on the ref this checkout has not pulled"   "$STALE" "$(cmdj "$READ_CMD")"

echo
echo "### the hazard runs one way: a row closed HERE is this tree's own closure"
# Measured 2026-10-21: a session committing `fixed #3833` on its own row was denied, and the guard
# printed `0 of them read OPEN here and are CLOSED on the ref` as it blocked.
printf '%s\n' "$REF_LEDGER" | sed 's/| 2026-10-03-charlie \(.*\)| OPEN |/| 2026-10-03-charlie \1| fixed #9003 |/' > "$STALE/briefs/RESIDUE.md"
expect ALLOW "a row closed here and OPEN on the ref"           "$STALE" "$(cmdj "$READ_CMD")"
printf '%s\n' "$REF_LEDGER" | sed 's/| fixed #9001 |/| → `ALPHA-BRIEF.md` |/' > "$STALE/briefs/RESIDUE.md"
expect ALLOW "a row closed on both sides, with different text"  "$STALE" "$(cmdj "$READ_CMD")"
write_ledger OPEN 'fixed #9002' 'fixed #9003' 'key'
cp briefs/RESIDUE.md "$STALE/briefs/RESIDUE.md"
expect DENY  "a stale OPEN row beside this tree's own closure"   "$STALE" "$(cmdj "$READ_CMD")"

echo
echo "### it fails OPEN where it cannot measure"
printf '%s\n' "$REF_LEDGER" > "$STALE/briefs/RESIDUE.md"
NOLED="$TMP/noledger"; git clone -q "$UP" "$NOLED" 2>/dev/null; rm -f "$NOLED/briefs/RESIDUE.md"
expect ALLOW "no ledger in this checkout at all"               "$NOLED" "$(cmdj "$READ_CMD")"
NOREF="$TMP/noref"; mkdir -p "$NOREF/briefs"; git init -q "$NOREF"
printf '%s\n' "$REF_LEDGER" > "$NOREF/briefs/RESIDUE.md"
expect ALLOW "a repo with no origin/main to compare against"   "$NOREF" "$(cmdj "$READ_CMD")"
expect ALLOW "no command and no path in the payload"           "$STALE" '{"tool_input":{}}'

echo
echo "### the writer's fate — the drain, not the exit code"
# ⚠ A HOOK THAT EXITS BEFORE READING STDIN STRANDS THE HARNESS. The pipe is deliberate: a redirect
# has no writer to lose. The hatch is staged, which is this hook's EARLIEST exit, so the leg watches
# the one path that could skip the drain. `tools/hook-contract.mjs` runs the same probe as a gate.
head -c "$_PROBE_BYTES" /dev/zero | tr '\0' x > "$TMP/stdin-big"
_worst=0
for _ in 1 2 3 4 5; do
  CLAUDE_ALLOW_STALE_LEDGER=1 bash -c 'cat "$1" | bash "$2" >/dev/null 2>&1; exit "${PIPESTATUS[0]}"' bash "$TMP/stdin-big" "$H"
  _rc=$?; [ "$_rc" != 0 ] && _worst="$_rc"
done
if [ "$_worst" = 0 ]; then printf '  ok    %-62s rc=0\n' "the hatch drains a payload past pipe-max, 5 writers live"
else printf '  FAIL  the writer into the hatched hook exited %s (141 = SIGPIPE, never read)\n' "$_worst"; fail=$((fail+1)); fi

echo
if [ "$fail" -eq 0 ]; then echo "✓ guard-stale-ledger.sh: every leg as declared"; exit 0; fi
echo "✗ guard-stale-ledger.sh: $fail leg(s) failed"; exit 1
