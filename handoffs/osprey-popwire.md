# Unit `popwire` — four night walkers report their population

**Row:** `2026-10-21-forty-one-corpus-enumerators-report-no-population` (claim #1257, Osprey). The row
stays **OPEN** — this unit is a named slice of it, not its discharge.

**Branch:** `claude/popwire-osp` · **Worktree:** `wt-popwire-osp` beside the primary checkout.

## What landed

Four tools filtered a root's children by the literal `YYYY-MM-DD` text that `NIGHT_RE` already
spells, and none said what set it read. Each now takes `snapshotNights` over that root before and
after the read and publishes the comparison through `populationVerdict`:

- `tools/deep-flow-join.mjs` — trio root; `--eve` is read by night key, so it is a lookup, not a
  second population.
- `tools/device-stability.mjs` — rows already carry `night`, so `notCovered` needed no bookkeeping.
- `tools/pat-ppg-ppg-control.mjs` — `eligible` read the list AFTER the `--only` cap.
- `tools/ppg2w-spo2-fit.mjs` — a session carries a 14-digit stamp for a name, so a `night` field rides along
  for the coverage line.

Three behaviours moved beyond the new lines: an unreadable root refuses by name rather than reporting
zero nights, a run that scored nothing prints its population, and `pat-ppg-ppg-control` reports the
offer rather than the capped list.

`UNWIRED_BACKLOG` in `tools/corpus-reads.mjs` goes 38 to 34, and the scan reads all four as
`reports`.

## Measured

- Probe safety is unchanged on every one of the four. `closureHazards` reads `["fs-write"]`,
  `["exec@dep","fs-write"]`, `[]` and `["exec@dep","fs-write@dep"]` before and after, because
  `corpus-scope-core.mjs` reads `[]`. The cost row
  `2026-10-26-wiring-a-population-verdict-costs-the-probe-safety-that-made-it-cheap` is historical
  for a new wiring.
- I measured the baseline IN the tool tree, as `tools/zz-base-<name>.mjs`, then removed it. A copy in
  the scratchpad would have lost its dep resolution.

## The two night walkers left out, and why

`pin-coverage.mjs` walks several roots in one run, which is the census question. `oxy-hr-bias.mjs`
holds a file population and a night population at once. Each gets its own OPEN row, dated
2026-10-28.

## Next step

Ask Kestrel for the undraft. I never undraft my own PR. The next slice of the parent row is either
of the two rows above, and the census shape is the larger of the two.

## Doc-search query that finds this

`node tools/doc-search.mjs --read "corpus enumerator reports no population night count"`
