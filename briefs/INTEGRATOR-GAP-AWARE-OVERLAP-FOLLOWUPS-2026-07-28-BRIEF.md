<!--
  INTEGRATOR-GAP-AWARE-OVERLAP-FOLLOWUPS-2026-07-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-31 · **Created:** 2026-07-28 · **Follows:** `INTEGRATOR-GAP-AWARE-OVERLAP-2026-07-27-BRIEF.md` (DONE 2026-07-28)

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

- [x] **§2.1 DONE 2026-07-31 — see §5.** Convention is *first sample AFTER the dropout*, stated at the definition in `parseECGText`, `mergeEcg` corrected from `idx - 1` to `idx`, gated structurally.
- [x] **§2.2 DONE 2026-07-31 — see §6.** PpgDex got a new committed twin; **OxyDex needed none** — its committed gap twin already drove the emitter and only lacked assertions. Both verified RED against a suppressed emitter.
- [x] **§2.3 DONE 2026-07-31 — see §7.** Rendered as an "Overlap coverage" KPI, badged `measured`, shown unconditionally, with the honest-null path pinned.
- [x] **§2.4 EXPLICITLY DECLINED 2026-07-31 — see §5.3.** No fourth caller has appeared; folding HRVDex in would mean teaching the shared helper about points-with-unknown-length for one call site.

---

## 5 · §2.1 EXECUTED and §2.4 DECLINED (2026-07-31)

### 5.1 The convention is "first sample AFTER the dropout"

Both producers now agree, and the disagreement §2.1 described was real — verified in the code, not
taken on the brief's word:

- **`ecgdex-dsp.js parseECGText`** pushes `{ idx: n - 1 }`, and `push()` for the current row runs
  *before* the gap check — so `n - 1` is the current, **post-gap** sample. First-after.
- **`tools/trio-batch.mjs mergeEcg`** pushed `{ idx: idx - 1 }` where `idx` is where the next
  session's first sample is about to land — so `idx - 1` was the **last pre-gap** sample. Last-before.

**First-after wins, and not by coin-toss — the consumer already required it.** The dead-time walk in
`ecgdex-dsp.js` tests `g.idx <= refIdx[k]` and credits the dropout to every beat at or past that
index. Under first-after, a beat landing ON the boundary sample is genuinely after the hole and
*should* carry the dead time. Under last-before, the beat immediately **before** the hole was credited
too — one sample, 7.7 ms at 130 Hz, immaterial against hour-scale segments (which is why it survived),
but wrong in the direction that **inflates** elapsed time. So `mergeEcg` was the side to fix.

The convention is now stated at the definition, where §2.1 asked for it, with the reasoning inline so
the next reader does not have to re-derive which side is correct.

### 5.2 Gated structurally, not on a magic index

The committed fragmented twin is three equal recorded segments, so the first gap must begin exactly
one segment in. The gate asserts that (±2 samples) rather than hard-coding an index — a last-before
producer lands one sample lower and is still separated by that tolerance. Measured: gaps at **871 and
1742**, against a segment length of 871. A second leg pins that the indices stay strictly increasing,
which is the property a merged multi-session stream must keep.

**Honest scope note.** The gate covers `parseECGText`, the definition site. `mergeEcg` lives in
`tools/trio-batch.mjs`, which the suite does not load, so its side of the convention is enforced by
the comment and by the shared structural expectation rather than by an assertion. A test-visible
`mergeEcg` would mean either loading the CLI tool into the suite or extracting the merge — neither
justified by a one-sample correction. **Stated because "gated" and "gated on both sides" are not the
same claim**, and §1 of this brief is precisely about that distinction.

### 5.3 §2.4 — declined, on its own stated criterion

§2.4 said folding HRVDex into `DexExport.coverageFromSegments` is *"worth doing only when a fourth
caller needs the same thing."* No fourth caller has appeared. HRVDex's shape is still genuinely
different — per-measurement rows whose own duration may be unknown, so `nWithDuration < n` and
`recordedSec` may legitimately be null, neither expressible by a stream-derived segment list — so
folding it in means teaching the shared helper about points-with-unknown-length for exactly one call
site. **Declining is the decision, not a deferral**: two writers of one shape exist, both correct, and
that is recorded here so the next reader does not re-open it as an oversight.

§2.2 (committed fragmented twins for PpgDex and OxyDex) and §2.3 (`overlapCoverage` rendered and
badged) remain open and carry real work.

---

## 6 · §2.2 EXECUTED (2026-07-31) — one twin was needed, the other already existed

§2.2 asked for **two** new committed inputs. Only one was needed, and finding that out first is the
difference between adding ~300 KB to the repo and adding ~600 KB.

### 6.1 OxyDex needed no new input — it needed an assertion

`uploads/synthetic_oxydex_o2ring_gap.csv` has been committed since `DEEP-AUDIT §5`, where it was built
for the **ODI-basis** divergence. It carries a 30-minute finger-off hole, so it was **already driving
the coverage emitter** — measured before writing anything: `n:2, recordedSec:5398, spanSec:7199,
source:"sensor-dropout"`. Nothing asserted any of it.

So the gap was never the input. It was that a committed input can exercise a code path and still leave
it ungated, which is §1 of this brief restated at the fixture layer. Four assertions now pin the block
on that existing twin, including that `recordedSec` is *materially* short of the envelope — the
property the whole block exists to express.

### 6.2 PpgDex genuinely needed one

Verified rather than assumed: `coverage()` returns **null** on both committed PpgDex inputs
(`synthetic_ppgdex_verity.txt`, `synthetic_ppgdex_o2ring_finger.txt`) — they are contiguous. So the
emitter had **no committed coverage at all**, and the gap derivation was gated only by inputs
hand-built inside the test, which is weaker in exactly the way the parent's §5 warns about.

`uploads/synthetic_ppgdex_verity_gapped.txt` is the same 40 s Verity stream with two arm-off holes
(6 s and 4 s) **cut out** — rows dropped, timestamps untouched, which is what a real off-link looks
like to the parser. Diffing it against the clean twin shows the gap and nothing else. Measured:
`n:3, recordedSec:30, spanSec:40, source:"ble-dropout"`.

**A control makes the pair meaningful:** the clean twin must still declare `null`. Without that leg,
the new assertions would also pass on an emitter that fires indiscriminately.

### 6.3 Both verified RED against a suppressed emitter

Exactly what §2.2's Done-when asked for. Forcing `coverage: null` in both DSPs reds both leading
assertions with `ABSENT — emitter suppressed?`:

```
✕ §2.2 · the fragmented Verity twin DECLARES coverage (the overlap denominator reads this)
✕ §2.2 · the committed gappy twin DECLARES coverage (the fusion denominator reads this)
```

Wired into **both** lanes (`pairCommitted` in `run-tests.mjs`, the `equiv` table in
`Dex-Test-Suite.html`) — `pairCommitted`, not `pair`, so a `DEX_UPLOADS` real-corpus override cannot
turn either gate into a silent skip.

**§2.3 (`overlapCoverage` rendered and badged) is now the only open item in this brief.**

---

## 7 · §2.3 EXECUTED (2026-07-31) — the block is on the card, and this brief is closed

`apnea.overlapCoverage` was published in the export and rendered nowhere, so telling 7 h-of-7 from
2 h-of-7 meant opening the JSON — for a ratio that **is the denominator the confirmed apnea index is
divided by**. It is now an `Overlap coverage` KPI on the same strip as that index:

- **value** — `recordedFrac` as a percentage
- **sub** — `<recorded> of <envelope> h`, plus either *declared by ECGDex + OxyDex* or *envelope
  basis — no node declared coverage*, so the reader can see which of the two regimes produced it
- **badge** — `measured`, graded in the fusion evidence table beside `desat_match`. It is arithmetic
  over declared segment lengths, not an inference, so it grades the same way.

**Three deliberate choices.**

*Shown unconditionally,* not only when coverage is poor. "We recorded all of it" is as much a fact as
the alternative, and a KPI that appears only on bad nights teaches a reader to skim past it.

*Tone warns only under 50 %.* Incomplete coverage is a caveat about the denominator, not a health
finding — colouring it by severity would import the exact confusion this brief's parent removed.

*A null `recordedFrac` renders "—", never 100 %.* The DSP returns null rather than 1 when the envelope
is zero, on the principle that a ratio with no denominator is unknown, not complete; the renderer had
to preserve that rather than collapse it, and the gate pins it.

### 7.1 Gated as a source-scan, and the difference is stated

Four assertions pin that the tile is **wired**: the renderer reads the block, routes it through
`kpi()` with an evidence key, that key is graded `measured`, and the null path renders an em-dash.

This is a **source-scan, not a render assertion** — driving the real KPI strip needs a DOM. The
painting half is covered by `integrator-render.js` already sitting in `BADGE_ENFORCED`, which requires
the badge to lead the value in every `kpi()` tile. Recorded plainly because §1 of this brief is about
fixes shipping without gates following, and "gated" and "gated end-to-end" are not the same claim.

### 7.2 Export-inert, PROVEN

`manifestHash 7e5b580eb2bd → f96612c0f1d6` while **`computeHash` is unchanged at `06cc68676ffb`** —
a render-only edit, so per `CLAUDE.md` §🔒 this is export-inert *computed*, not asserted, and no
fixture re-verification is owed. No fixture moved.

### 7.3 The brief is closed

§2.1 (§5), §2.2 (§6) and §2.3 (§7) executed; §2.4 declined on its own criterion (§5.3). Nothing
spawned a follow-up: each item was either completed or explicitly declined with the reason recorded.
