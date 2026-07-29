<!--
  INTEGRATOR-GAP-AWARE-OVERLAP-FOLLOWUPS-2026-07-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-28 · **Follows:** `INTEGRATOR-GAP-AWARE-OVERLAP-2026-07-27-BRIEF.md` (DONE 2026-07-28)

# What emitting `recording.coverage` turned up

The parent is closed: three capture nodes declare their holes, the fusion export publishes which
denominator it used, and a committed fragmented twin holds the line in CI. This is the residue.

---

## 1 · What execution taught

### 1.1 The holes were never inside a file — they are BETWEEN files

The parent brief reads as if a night's fragmentation lives inside each recording, and the acceptance
item said as much: *"the session boundaries are already known at parse time (ECGDex tracks `gaps`)"*.
On the real corpus that is only half true. Parsing every `*_ECG.txt` and `*_PPG.txt` of **2026-07-23**
individually yields **`gaps = 0` on every single file** — each capture-host session is internally
clean. The night is fragmented because there are **6 ECG files and 107 PPG files**, not because any one
of them has a hole.

So the per-file emitter, taken alone, would have been **completely inert on the corpus it was written
for** — green tests, correct code, zero effect. What makes it bite is `tools/trio-batch.mjs`, which
merges a night's sessions into ONE rec and carries the off-link silence forward as a synthesised `gaps`
entry. That merged shape is the one the Integrator actually sees, and it is now pinned by its own
assertions.

**The lesson is the parent's own §5 lesson one level up:** a fixture that cannot express the failure
proves nothing, and neither can a *code path* that the real data never takes. Check which path
production uses before deciding a fix is done.

### 1.2 A sample index is not a clock position

The merged rec carries `{idx, ms}` with no relative-ms column, and the obvious reading — sample `idx`
sits at `idx/fs` — is wrong after the first dropout by exactly the accumulated silence. It is wrong
*quietly*: the segment count is right, the total is right, and only the POSITIONS drift, which is
precisely the thing an overlap intersection is made of. Caught by writing the assertion first
("the last segment starts after BOTH holes"); the naive version loses a segment outright under
mutation. Worth remembering wherever data-time and wall-time meet — the same confusion the
`NODE-EXPORT-DURATION-SEMANTICS` ruling exists to settle.

---

## 2 · Open work

### 2.1 `mergeEcg` and `parseECGText` disagree about what `gaps[i].idx` means

`parseECGText` writes the index of the **first sample AFTER** the dropout; `tools/trio-batch.mjs`
`mergeEcg` writes the index of the **last sample BEFORE** the join. One sample, 7.7 ms at 130 Hz —
immaterial against segments measured in hours, which is why `ecgCoverage` absorbs it rather than
guessing which producer it is reading. But it is an undocumented disagreement between two producers of
one structure, and the next consumer may not be measuring hours. Pick one convention, state it where
`gaps` is defined, and fix the other side.

### 2.2 Only ECGDex has a fragmented committed twin

PpgDex's and OxyDex's derivations are gated by hand-built inputs inside the test, not by a committed
vendor-format file with a golden. That is weaker than what ECGDex now has, and weaker in the exact way
the parent's §5 warns about — a hand-built input in a test can drift with the test. Two more twins
(`synthetic_ppgdex_verity_gapped.txt`, `synthetic_oxydex_o2ring_fragmented.csv`) would close it, and
`tools/make-synthetic-inputs.mjs` already has the generators to fork.

### 2.3 `apnea.overlapCoverage` is published but not rendered

The block exists so a reader can tell 7 h-of-7 from 2 h-of-7. Nothing in the Integrator's UI shows it
yet, so today that reader has to open the JSON. A `recordedFrac` well under 1 beside a published AHI is
exactly the kind of thing a fusion card should say out loud — and per the CLAUDE.md coverage mandate it
would need an evidence badge when it surfaces.

### 2.4 HRVDex still hand-rolls its coverage literal

`DexExport.coverageFromSegments` now single-sources the block's assembly for three nodes; HRVDex — the
node the block was *invented* for — still builds its own literal inline. It is correct, and its shape is
genuinely different (per-measurement rows whose own duration may be unknown, so `nWithDuration < n` and
`recordedSec` may legitimately be null, neither of which a stream-derived segment list can express).
Folding it in means teaching the shared helper about points-with-unknown-length. Worth doing only when
a fourth caller needs the same thing — until then, note that two writers of one shape exist.

---

## 3 · Deliberately not done

- **A committed THREE-NODE fusion golden.** The parent's acceptance item asked for a three-node night
  with holes. What landed is a single-node committed twin plus a fusion-level test in which two
  fragmented nodes share one recorded hour of a seven-hour envelope. A committed three-node golden
  would pin the Integrator's ENTIRE output tree — every finding, every null-model number — against a
  synthetic night, which is a much larger fixture with a much larger maintenance surface than the
  question being asked. The denominator is what this brief was about, and the denominator is pinned.
- **Back-filling coverage onto the historical `integrator_fusion_*` fixtures.** They are
  `historical:true` — byte-pinned, not code-gated, produced by code that has since evolved. Re-recording
  them would assert a reproducibility that is not true.

---

## 4 · Done when

- [ ] §2.1 one `gaps[].idx` convention, documented at the definition and honoured by both producers
- [ ] §2.2 committed fragmented twins for PpgDex and OxyDex, each verified RED against a suppressed emitter
- [ ] §2.3 `overlapCoverage` surfaced in the Integrator UI, badged
- [ ] §2.4 revisited when a fourth caller appears, or explicitly declined
