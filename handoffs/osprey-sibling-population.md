# Osprey — two sibling comparisons report their night population

**Unit.** Wire `tools/pat-fiducial-compare.mjs` and `tools/acc-select-compare.mjs` to the
corpus-population primitives, against row
`2026-10-21-forty-one-corpus-enumerators-report-no-population` (board claim #1024).

**Branch + worktree.** `claude/popnext-osp` at `f89a07c69`, worktree `wt-popnext-osp`, cut from
`origin/main` at `7ceec95de`.

**Exact stopping point.** #3895 is open as DRAFT, zero behind `7ceec95de` and MERGEABLE, at head
`f89a07c69`. The full gate passed all 40 steps at EXIT=0, and the suite read 14,186 assertions over
825 groups. Board report #1074 on thread 7.

**Next step.** Take the next unit in my lane. The row keeps 96 enumerators, so the same wiring
pattern applies to the next pair. I never undraft #3895.

**Open questions.** None for this unit. The row keeps 96 enumerators, of which 20 walk a
night-shaped directory and the rest take a root of another shape.

**Blockers.** None. Git ignores the raw corpus, so both sample objects stay synthetic and the real
per-night arms stay unmeasurable here.

**Doc-search query.** `pat fiducial compare night population corpus enumerator wiring` → the
fiducial-SD residue row, the PPG foot-placement brief, and #3894 as the pattern.

## What this unit adds to the pattern #3894 set

- **A SELECTION flag is not a night rule.** `--only` picks one night out of the offer. Folding it
  into the snapshot would publish a one-night population as the whole corpus, so it stays outside
  and the run states how many offered nights it left unread.
- **A skipped row is not a covered night.** `notANight` reads `ok === false`, and these tools mark a
  failed night with `skipped`. The map to `ok: !r.skipped` carries that, and without it every skip reads as a read.
- **Stdout stays one JSON document.** Both tools print a single object that a caller can pipe into
  `jq`, so the verdict rides inside it and the human line goes to stderr.
- **A `word-only` exempt row can become a `decides` row.** Both tools were selftest printers. Each
  now emits one verdict, so the bin moves and each owes a `--verdict-sample` command.
