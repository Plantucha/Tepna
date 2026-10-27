# Unit wire14 — two backlog corpus enumerators report their population

**Unit.** Wire a slice of the 14 probe-safe unwired corpus enumerators (#1335's cost table) to report
the population each one walked, under claim #1257 for row
`2026-10-21-forty-one-corpus-enumerators-report-no-population`.

**Branch + worktree.** `claude/wire14-osp` in `wt-wire14-osp`, cut from `19fee8e74`. No commit yet, and
nothing pushed: #3937 holds my one PR slot (board #1075 precedent for holding a unit).

**Exact stopping point.** All edits are in the worktree and formatted:
- `tools/ppg-gap-bridge-scan.mjs` — `snapshotEntries` over the `O2Ring*_PPG.txt` offer, unit
  `ppg-files`; `--top` is a selection over the offer; `--verdict-sample`; selftest 5 → 10 green.
- `tools/beat-comb-analysis.mjs` — `snapshotNights(dir, { re: /./ })`, keeping the tool's own wide
  rule; `notANight` names a night with no loadable pair; `--verdict-sample`; selftest 21 → 25 green.
- `tools/verdict-adoption.json` — the scan moves `word-only/exempt` → `decides/adopted`, the sweep is a
  new `decides/adopted` record; `--check` reads 136 `decides` and byte form canonical.
- `tools/corpus-reads.mjs` — both names leave `UNWIRED_BACKLOG`, 44 → 42.
- `changes/2026-10-26-corpus-population-two-enumerators.md`, ste-lint 0 findings.
Gate: `npm run check` aborts at step 5 `verify:residue-claims` on the REF's own claim (Heron #1342), so
a 39-step filtered run is in flight; its log is the `check39.log` in this session's scratchpad.

**Next step.** Read the 39-step verdict. If green, commit the five paths and hold the branch unpushed
until #3937 merges, then push and open the PR with the `Rule 0:` line from the query below.

**Open questions.** None for this unit. `snapshotEntries` has no field for the caller's selection rule,
so a reader of the verdict cannot see that a name pattern grew wider — a row for my next residue
batch, not a blocker here.

**Blockers.** Step 5 reds for every branch cut from `19fee8e74` until Kestrel lands the state cell on
`2026-10-22-the-adoption-population-is-keyed-on-a-literal-word-anywhere-in-the-file`. The one-PR cap
holds the push.

**Doc-search query.** `node tools/doc-search.mjs --read "a corpus enumerator that scans files reports no
population and truncates with --top"` → board #816 (the classifier), board #1010 (my claim),
`tools/h10-session-rate.mjs` (the name is the population).

Fleet-Session: Osprey
