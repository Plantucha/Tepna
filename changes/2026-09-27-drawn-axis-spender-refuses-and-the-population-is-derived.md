---
bump: patch
type: fixed
brief: KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md
---

`tools/pat-drift-attribution.mjs` no longer spends a DRAWN device axis as a second clock: `effectivePpm`
refuses on `deviceDrawn` with its own named reason (`device axis drawn — …`), surfaced on the per-night
line beside the row it killed. And the gate that was supposed to catch this now derives its population
instead of naming two tools by hand.

**The defect, measured on `origin/main`:** `effectivePpm({ ok:true, ppm:-22.83, independent:true,
deviceDrawn:true, drawnShare:0.993 })` returns **−22.83** where the Clock Contract requires `null`. That
number is real — it is a measured O2Ring segment, a textbook-plausible crystal from a stream with **no
oscillator**. It was differenced against the other leg into `pred` and handed to `attribute()`, which
reported **CLOCK EXPLAINS**: observed lag drift attributed to a clock that does not exist. `independent`
cannot catch it and reads the *wrong way* on it — it compares two COLUMNS, so a synthesised counter reads
MORE independent the coarser the fabrication.

**Why it stayed invisible for eight days.** The suite's `drawn-axis · source-scan` group is titled *"every
tool that spends a clock"* and its population was a HAND LIST OF TWO. A third spender was not failing that
gate — it was outside it, and absence from a hand list is indistinguishable from passing. The brief's own
status line inherited the over-claim (*"the `deviceDrawn` refusals now sit in every tool that spends a
clock and the suite's group pins them"*, verified 2026-09-01), which was true of the two named files.

The population is now DERIVED: every `tools/*.mjs` whose CODE reads `.ppm` or `correctionAt` — comments
stripped first, because four files matched only in prose and a scan that reads its own documentation
examines nothing (§4b). It is a deliberate SUPERSET, on `computeHash`'s own denylist reasoning that an
unknown asset belongs inside the closure. **11 in the population, 7 reading a real host axis**, each
classified as an EQUALITY with the denominator printed: 4 REFUSES (conditional asserted, not the bare
identifier — the identifier also appears in every refusal body), and 3 EXCLUDED whose reasons name which
side of §7's line they sit on — `pat-matchrate-strict` PLACES (reconstructs the axis the DSP already
applied), `known-clock-recovery` and `pat-axis-leg-audit` REPORT (forward the flag rather than gate on
it). The remaining 4 read a `.ppm` that is their own fit and are pinned as a named set.

**Two premises corrected, both recorded in the brief.** `ecgdex-dsp.js` must NOT refuse a drawn axis —
§7 says it may be PLACED on a host timeline, the host is then the only clock there is, and refusing would
leave every sample on the assumed rate, *strictly worse*; the migration there was a RELABEL. And
`pat-gate.js` already refuses, keyed on `timingSource === 'none'`, deliberately admitting `'host'`. Both
were named as targets by a residue row whose consumer list a prior row had already refuted eight days
earlier.

Plants: 11 new assertions in the tool's own `--selftest` (11 → 22), every one failing on `origin/main`,
with an anti-vacuity leg — a real H10 axis (measured `drawnShare` 0.0038–0.0677) still contributes its
ppm, so the guard cannot pass by refusing everything — plus a plant that fails if the drawn refusal ever
prints the BORROWED `no host reference` reason belonging to the independence gate (§∅: a named reason,
never a borrowed one).
