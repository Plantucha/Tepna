<!--
  NODE-EXPORT-DURATION-SEMANTICS-2026-07-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-06 (§8 closed the last two items by MEASUREMENT, and both premises were wrong: PpgDex's `durSec` already means DATA so the proposed rename would have broken it, and MotionDex's fabricated-duration fallback fires 0× in 616 real files. Both gated, both gates verified RED. The 26 Hz constant is wrong by up to 7.8× if ever reached — routed, not patched.) · **Spawns:** `NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-2026-08-06-BRIEF.md` · **Created:** 2026-07-27 · **Follows:** `NODE-EXPORT-RECORDING-DURATION-2026-07-24-BRIEF.md` (which asked whether a node declares a length at all; this one asks what it MEANS) · **Decision:** owner-ratified 2026-07-27 (option (c)) · **Builds-on:** `DEEP-AUDIT-III-2026-07-26-BRIEF.md` §6.2 (`recording.coverage`, landed `986d17e`) · **Relates:** `INTEGRATOR-GAP-AWARE-OVERLAP-2026-07-27-BRIEF.md` (§5 — the coverage model this ruling completes), `CAPTURE-HOST-INTEGRATOR-FOLD-2026-07-24-BRIEF.md` (added the `durSec` key whose meaning this pins down)

# `recording` publishes BOTH a data duration and a clock end — one scalar cannot answer two questions

> **The ruling (option (c), ratified 2026-07-27).** A node-export's `recording` block carries **`durSec`
> — how much signal the node actually has** — *and* **`endEpochMs` — where the recording ends on the
> clock**. Neither replaces the other, and their ratio is the coverage fraction. The alternatives were
> (a) data-seconds alone and (b) wall-span alone; each answers one question and silently mis-answers the
> other.

---

## 1 · Why the question existed

The three trio nodes disagreed, and nothing said which was right:

| node | field | derivation | meaning |
|------|-------|------------|---------|
| ECGDex | `durSec` | `n / fs` (parser) → `nnRes.activeSec` (analyze) | **data seconds** |
| PpgDex | `durSec` | `(n − 1) / fs` over a **gap-filled grid** | **near** wall span — short by up to 6.6 min on a gappy night (§6.1) |
| OxyDex | `durationMin` | `last.tMs − first.tMs` | explicitly **wall span** |

On 2026-07-17 that is ECGDex **8.92 h** against PpgDex **14.54 h** / OxyDex **14.62 h** — for one night.
Both readings are defensible; having both under one name is not.

**The measured consequence** (2026-07-16…26 capture corpus, 11 nights): because ECGDex declares data
seconds and nothing else, `t0 + durSec` lands short of where the recording actually ended by exactly the
dropout time — so **ECGDex's own events fell outside its own declared window on 11 of 11 nights**, by
**+8 min to +326 min**. The node under-declared where it stopped.

## 2 · Why (a) or (b) alone is not enough

- **(a) data-seconds alone** — correct for every *per hour of recording* rate (HRV coverage, beats/hour, quality %) but **is not a position on the clock**: `t0 + durSec` names an instant where nothing happened. This is the state ECGDex was in, and §1 is what it cost.
- **(b) wall-span alone** — bounds the recording correctly on the clock, so windows and overlaps are right, but says nothing about how much of that span is real. That is precisely the defect `INTEGRATOR-GAP-AWARE-OVERLAP` documents: a night that is mostly holes reports full-span coverage.
- **(c) both** — each field answers the question it is actually asked, and `durSec / (endEpochMs − startEpochMs)` is the coverage fraction for free. **No consumer change is required**: `integrator-dsp.js normalizeFile` already prefers `endEpochMs` over every duration key, so a node that gains the field is honoured immediately and a node that has not gained it yet behaves exactly as today.

## 3 · The contract

```
recording: {
  startEpochMs,   // floating wall-clock ms of the FIRST sample (unchanged)
  endEpochMs,     // floating wall-clock ms of the LAST sample — READ, never derived; null if unknown
  durSec,         // seconds of ACTUAL SIGNAL (excludes dropouts); null if unknown
  …
}
```

Two rules, both non-negotiable:

1. **`endEpochMs` is read, not reconstructed.** Deriving it from `durSec` + a gap list is a guess, and Clock Contract §2.6 says a value we do not have is `null`, never fabricated. ECGDex reads the last row's Phone timestamp; the value round-trips that stamp exactly (`2026-06-17T01:12:19.371` → `1781658739371`).
2. **Absent ⇒ today's behaviour.** The field is additive. A `null` is honest and costs nothing: on a gapless recording the Integrator's existing `t0 + durSec` fallback is already exact, which is why no derived fallback was added for the synthetic path.

## 4 · Status per node

| node | `durSec` semantics | `endEpochMs` | state |
|------|--------------------|--------------|-------|
| **ECGDex** | data ✓ | ✓ **shipped 2026-07-27** | **DONE** — parser reads the last stamp, `analyze` carries it (a recording property, not an analysis one, same as `offsetMin`), both goldens regenerated |
| PpgDex | **span** ✗ — needs the coverage model to become data | ✗ | pending |
| OxyDex | **span** ✗ | ✗ | pending |
| MotionDex | `Math.round(durSec)` — data (verify) | ✗ | pending |
| PulseDex · HRVDex · GlucoDex · CPAPDex | unaudited | ✗ | pending |

**Why ECGDex first and alone:** it is the only node where the defect was *measured* (11/11 nights), and
the only one whose `durSec` is already data — so it needed the additive half only, with no change to an
existing field's meaning. The remaining nodes split into two very different jobs:

- **Adding `endEpochMs`** is additive everywhere and can proceed node by node.
- **Making `durSec` mean data** for PpgDex/OxyDex is *not* additive — it changes a published field's meaning,
  and it requires a per-node definition of "present data" (for a gap-filled PPG grid, which slots count?).
  **That definition now EXISTS**: `986d17e` (DEEP-AUDIT-III §6.2) shipped `recording.coverage =
  { kind, spanSec, segments, recordedSec, … }`, which is this ruling in a richer shape — `spanSec` is the
  envelope, `recordedSec` is the data, and they are deliberately separate so neither reads as the other.
  So the remaining nodes should adopt **`coverage`**, not a second convention: `endEpochMs` answers the
  envelope question for a node that records continuously, and `coverage.segments` answers it for one that
  does not. `INTEGRATOR-GAP-AWARE-OVERLAP` §2 shows the three capture nodes are in the second category and
  emit no coverage today — that is the work, and it subsumes the `durSec` renaming rather than preceding it.

## 5 · Cost of the remainder (why it was not done in one pass)

~15 emitters across the DSPs, the apps, `cohort-worker.js` and `synth-gen.js`. Every node-export gains a
key, so **every code-gated fixture's `outputHash` moves** and all 8 regen tools must run; 8 apps plus the
3 orchestrators re-bundle, which **re-stamps every `provenance/<App>.json` fragment at once** — i.e. it
serialises against every other session touching a bundle (`CLAUDE.md` §👥.3). That is a coordinated
work-unit to schedule, not a drive-by.

## 6 · Done when

- [x] ECGDex publishes both; read-not-derived; `null` when stampless; gated (`ecgdex-dsp` group **ECGDex recording bounds**, incl. a dropout stub where data and wall span provably disagree).
- [x] A coverage definition exists (`986d17e` §6.2 `recording.coverage`) — adopt it rather than inventing a second one.
- [x] `endEpochMs` where it CORRECTS something — **ECGDex + PpgDex, both DONE.** §7 audits the other
      six and finds none of them has the defect: each already derives a SPAN, so `t0 + dur` lands on
      the clock end by construction (±1–3 s of rounding). The field there is uniformity, not a fix,
      and §7.3 recommends it ride each node's next behavioural re-bundle rather than churn six
      bundles and every fixture for seconds.
- [~] **OxyDex re-audited 2026-08-04 — §4's `pending` is STALE; it already satisfies (c), in its own
      vocabulary.** Measured over the 42-night O2Ring corpus (12 sampled): `durationMin` is the
      ENVELOPE and `recording.coverage.recordedSec` is the DATA, exactly the two-scalar split the ruling
      asks for — only the names differ from ECGDex's `endEpochMs`/`durSec`.

      | durationMin | cov.kind | spanSec | recordedSec | data/span | segs |
      |---|---|---|---|---|---|
      | 460.0 | sparse | 27599 | 27528 | 0.9974 | 2 |
      | 440.0 | sparse | 26399 | 26328 | 0.9973 | 2 |

      `durationMin × 60` tracks `spanSec` to within a second, **not** `recordedSec`. The other 10
      sampled nights are contiguous and carry **no coverage block at all** — deliberate: a contiguous
      night has no hole to declare, so claiming 100 % would be a measurement nobody made.

      So the remaining work is **naming uniformity, not missing information**, which §7.3 already routes
      to "ride each node's next behavioural re-bundle". Renaming now would change a published field's
      meaning to buy nothing a consumer cannot already read.

      **Gated instead** (`oxydex-dsp · export · duration-semantics`, 10 assertions): the invariant that
      the remaining item could break is that `durationMin` keeps meaning the envelope. Mutation-verified
      — making it report data-seconds reds by value (`durationMin*60=2520s · spanSec=4199`). A silent
      denominator change is now impossible, which was the actual risk.

      Still open for **PpgDex** (its `durSec` is a gap-filled-grid span). Not touched here: it is the
      node where the rename genuinely changes a published number.

      **→ CLOSED 2026-08-06 by measurement (§8.1). The premise was wrong: PpgDex's `durSec` already
      means DATA, not span, so no rename is owed and none was made.** Gated instead
      (`ppgdex-dsp · export · duration-semantics`, 7 assertions), mutation-verified against the exact
      rename this item proposed.
- [x] `bump: minor` — the export gains a field. Satisfied per work-unit as each node landed:
      `changes/2026-08-03-ppgdex-endepochms.md`, `changes/2026-08-03-endepochms-audit.md`,
      `changes/2026-08-04-oxydex-duration-semantics.md`. **This closing pass is `patch`** — it adds
      gates and corrects the record; no export moved.
- [x] Per node: regen goldens, re-bundle, `build.mjs --check`, `verify-manifest.mjs` GATE A+B, and — since `computeHash` moves — `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`.
      Done for the two nodes whose export actually moved — ECGDex (2026-07-27) and PpgDex (2026-08-03;
      §6.3 records the moved `computeHash` and the re-verification). **Not owed by the remaining six:**
      §7 measured that none of them has the defect, and §8.2 measured that MotionDex — the one §7.3
      singled out — does not either. This closing pass is test-only and moves no bundle.
- [x] **§8 · The two conditionals §7 left open are resolved by MEASUREMENT (2026-08-06).** PpgDex's
      `durSec` already means data (§8.1); MotionDex's fabricated-duration fallback never fires (§8.2).
      Both gated, both gates verified RED against the change they refuse.


---

## §6 · EXECUTED 2026-08-03 — PpgDex gains `endEpochMs`

### 6.1 · The brief's own table was optimistic about PpgDex, and it is worth correcting

§1 lists PpgDex's `durSec` as *"effectively wall span"*, on the reasoning that the sample grid is
gap-filled — which would make `t0 + durSec` land on the clock end and this field redundant here. That is
why PpgDex was grouped with OxyDex as "span ✗, needs the coverage model" rather than treated as an
additive case like ECGDex.

Measured over the capture corpus, driving the shipped `parsePPG` against the last parseable Phone stamp:

| night | `nGapSpanIntervals` | `t0 + durSec` vs the last stamp |
|---|---|---|
| `20260727221106` | 6317 | **6.6 min short** |
| `20260723013336` | 794 | **1.0 min short** |
| `20260801023357` | 70 | 0.1 min |
| `20260801001305` · `20260731212656` | 57 · 64 | ~0 |
| four largest contiguous nights | — | 0.0–0.1 min |

The gap-fill does **not** recover all lost time; the shortfall scales with gap burden. Far smaller than
ECGDex's measured +8…+326 min, but the same defect class — and exactly why §3 says the field is **read**,
not computed. PpgDex needed the additive half after all.

### 6.2 · What landed

`parsePPG` now carries `endEpochMs`, read from the last row whose stamp parses; `analyze` carries it
through (a property of the RECORDING, not of the analysis — the same reason `offsetMin` needs an explicit
carry); the export publishes it beside `durSec`. §P1's performance win is preserved: the backward scan is
memoised and runs at most once, over ≤40 rows, only where the value is actually read — the per-row
`parseTimestamp` that §P1 removed stays removed.

Gated by `PpgDex recording bounds — endEpochMs is read from the last stamp, never derived`: gapped and
gapless synthetic twins differing only by a 20 s dropout, asserting the stamp is hit to the millisecond on
both, that `t0 + durSec` lands ~20 s short on the gapped one, and that the gapless twin has no such
shortfall (so the gap is what separates them, not the fixture shape). Mutation-verified four ways — the
one that matters is **"simplify `endEpochMs` to `t0 + durSec`"**, the refactor this gate exists to refuse.

**One assertion is deliberately absent.** Clock Contract §2.6 asks that an unknown stamp be `null`, never
fabricated — but for PpgDex that state is **unreachable through `parsePPG`**: a PPG export in which no row
carries a parseable stamp is rejected wholesale, because the layout detector needs the stamp column to
identify the file at all. The `?? null` guard stays (it costs nothing and is the honest default if that
ever changes), but asserting it would assert a branch no input can reach. ECGDex differs — its parser
accepts stamp-less rows — so its sibling gate does pin the null there.

### 6.3 · Compute-path

```
manifestHash  e3b832216694 → f6860a2fd92e   (MOVED)
computeHash   7b7a072ac320 → e38a8746cead   (MOVED ⇒ re-verification owed)
```

The equiv gate reds on sight, which is the GATE-C surface doing its job: the export gained a field, so all
four PpgDex goldens were **regenerated** (never hand-edited) — one field moved in each,
`recording.endEpochMs: undefined → …` — and `verify-fixtures` re-stamped the real corpus fixture
`verifiedUnder → e38a8746cead` after a green run. `bump: minor`, per §5: the export gains a field.


---

## §7 · AUDITED 2026-08-03 — the remaining six do NOT have this defect

§5's item reads *"`endEpochMs` on the remaining 7 nodes (additive)"*, which treats them as uniform work.
They are not. Reading each node's derivation and measuring it against the real corpus:

| node | duration field | derived from | is `t0 + dur` the clock end? |
|---|---|---|---|
| **ECGDex** | `durSec` | `n / fs` — **DATA seconds** | **NO** — short by every dropout (+8…+326 min). **DONE 2026-07-27** |
| **PpgDex** | `durSec` | `(n−1)/fs` over a gap-filled grid | **NO** — short by up to **6.6 min** (§6.1). **DONE 2026-08-03** |
| OxyDex | `durationMin` | `rows[n−1].tMs − rows[0].tMs` | **yes**, ±3 s (0.1-min rounding) |
| MotionDex | `durSec` | last row's `relSec`, `Math.round` | **yes**, ±1 s |
| PulseDex | `durationMin` | `times[N−1]` (last beat time) | **yes** |
| GlucoDex | `durSec` | `spanMs / 1000` | **yes**, by definition |
| CPAPDex | `durSec` | `max(session.t0Ms + durMin)` − `t0Ms` | **yes**, by construction |
| HRVDex | per-row `durSec` | explicit per row | already span-shaped (§1136 comment) |

**Only the two nodes that declare DATA seconds had the defect, and both are now fixed.** The other six
already compute a span, so the clock end is recoverable from what they publish today to within the
rounding of the field itself.

### 7.1 · Measured, not inferred

- **OxyDex** — `durationMin` is `rows[n−1].tMs − rows[0].tMs`, so it *is* the wall span. Over the 37-night
  corpus the residual against the true last stamp is **max 3.0 s, median 2.0 s** — purely the `.toFixed(1)`
  rounding to 0.1 min. The `_durBad` guard (non-monotonic **or** inflated) would null `durationMin` while
  the last stamp is still known, which is the one case where `endEpochMs` would carry real information —
  and it fires on **0 of 37** nights.
- **MotionDex** — `durationOf` returns the last row's `relSec`, rounded to the second. One caveat worth
  keeping: it falls back to `rows.length / 26` when `relSec` is unavailable, which is a **fabricated**
  duration (an assumed 26 Hz). On that path `t0 + durSec` is a guess and `endEpochMs` *would* be honest —
  so MotionDex is the strongest of the six, conditional on that fallback actually firing.

### 7.2 · What this costs, weighed honestly

Adding the field to a node is not free: it moves the export, which reds the equiv gate, which requires
regenerating every one of that node's goldens, re-bundling, re-running three build systems, and
re-stamping `verifiedUnder` under a moved `computeHash`. That is the right price for ECGDex's +326 min and
PpgDex's 6.6 min. It is a poor trade for **2–3 seconds**.

`CLAUDE.md` already carries this exact economics twice — the inert `BADGE_CSS` export and the deferred
version stamp both say *"re-bundle only when runtime behavior changes"*. The same reasoning applies here.

### 7.3 · Recommendation

**Let `endEpochMs` ride each remaining node's next behavioural re-bundle** rather than scheduling six
bundle-and-regenerate cycles for uniformity. The Integrator needs no change either way: `normalizeFile`
already prefers `endEpochMs` over every duration key and falls through to `durSec`/`durationMin`, so a node
that has not gained the field behaves exactly as today — which is the property §3 relied on to call this
additive in the first place.

**The one to prioritise is MotionDex**, and only if its `rows.length / 26` fallback is shown to fire on
real captures: that is the sole remaining path where the published duration is fabricated rather than
measured, and it is the same honest-null argument the Clock Contract makes everywhere else.

> **§8.2 ran that measurement. The fallback fires 0 times in 616 real files, so the condition is FALSE
> and MotionDex does not need the field.** The recommendation stands as written; what it did not
> anticipate is that the *constant* is wrong — see §8.2.


---

## §8 · CLOSED 2026-08-06 — the two remaining items were both PREMISES, and both were wrong

§7 left the brief resting on two conditionals rather than two measurements: PpgDex "needs the rename"
and MotionDex "needs `endEpochMs`, if the fallback fires". Neither had been run against the corpus.
Both were run. **Both premises are false, in opposite directions**, and the pattern is the one this
brief has now hit four times — §6.1 (PpgDex was optimistically grouped with OxyDex), §7 (the remaining
six were treated as uniform work), the OxyDex `[~]` (its `pending` was a year-stale label), and now
these two. *The table entry describing a node is not the node.* Every correction here came from
driving the shipped code over real files; none came from re-reading the source.

### 8.1 · PpgDex's `durSec` already means DATA — the rename would have made it WRONG

**Method.** The shipped `parsePPG` → `compute` over every ≥2 MB `*_PPG.txt` in the capture-host tree:
**322 files**, of which **90 carry a `recording.coverage` block** (28 % — the rest are contiguous and
correctly decline to claim coverage at all). For each, `durSec` was compared against the two scalars
that are unambiguous by construction — `coverage.recordedSec` (the data) and `coverage.spanSec` (the
envelope).

| `durSec` is closer to… | p50 of \|Δ\|/span | p95 of \|Δ\|/span | files it is nearest |
|---|---|---|---|
| **`coverage.recordedSec` — the DATA** | **0.052 %** | **0.227 %** | **75 / 90** |
| `coverage.spanSec` — the ENVELOPE | 0.425 % | 2.496 % | 4 / 90 (+11 tied) |

An order of magnitude nearer the data. The four "nearer span" files all have 1–8 s of total loss, where
the two scalars are not distinguishable anyway. On the gappiest night in the corpus
(`…20260727221106`, 6297 gap intervals) the three numbers are `durSec 22343 · recordedSec 22297 ·
spanSec 22737` — 46 s from the data, 394 s from the envelope, over 6.3 hours.

**§6.1 had already measured the evidence and stopped one step short of the conclusion.** It found
`t0 + durSec` landing 6.6 min short of the last stamp and read it as *"the gap-fill does not recover
all lost time"* — true, and the step not taken: **a duration short by exactly the dropout IS
data-seconds.** That is ECGDex's signature (§1), not OxyDex's. So §1's table (`durSec` = "**near**
wall span") and this section's own Done-when item ("a gap-filled-grid span") describe a field the node
does not publish.

**Consequence: PpgDex already satisfies option (c)**, and satisfies it in the ruling's *own*
vocabulary rather than OxyDex's — `durSec` is the data, `endEpochMs` (landed 2026-08-03) is the clock
end. Performing the proposed rename would have taken the one node that had both fields right and given
it two envelopes and no data.

**Gated** — `ppgdex-dsp · export · duration-semantics`, 7 assertions. Mirror image of the OxyDex gate:
there the invariant is *"`durationMin` keeps meaning the envelope"*, here it is *"`durSec` keeps
meaning the data"*, so a silent numerator change is now impossible in either direction. A gapped/gapless
synthetic twin pair separated by a 20 s dropout pins `durSec ≡ recordedSec` (47.72 vs 48),
`endEpochMs − t0 ≡ spanSec` (67.72 vs 68), and — as the CONTROL — that the gapless twin collapses the
two and declares no coverage block. **Mutation-verified against the literal change the item proposed:**
redefining `durSec` as `(endEpochMs − t0Ms)/1000` reds 2 assertions by value (`durSec=67.72s ·
recordedSec=48s`), while the CONTROL assertions correctly stay green — so the gate is pointed at the
gap, not at the fixture's shape.

### 8.2 · MotionDex's fabricated-duration fallback never fires — but 26 is the wrong constant

**Method.** The shipped `parseSensorXYZ` over every ≥200 KB ACC stream in **both** corpus trees
(`tepna-smoketest/captures` + `Ecg nightly`): **616 files · 121,429,712 rows · 690 hours**. For each,
the exact branch condition in `durationOf` was evaluated — is the last row's `relSec` resolvable?

**It fires 0 times.** Not one parsed row anywhere lacks *both* a Phone timestamp and a device counter
(0 files with any null `tMs`, 0 with any non-finite `relNs`). So §7.3's condition is false and
**MotionDex does not need `endEpochMs`** — the honesty gap it was conditioned on does not exist in the
field, and §7.2's economics apply unopposed.

**What the same run also shows, and §7.1 could not have known:** the delivered ACC rate across those
files runs **20.9–202.7 Hz** (H10 median 50.7, Verity median 51.7), so the assumed 26 Hz is not merely
a fallback — it is **wrong by 0.8×–7.8×** for the corpus it would be applied to. Reached today only by
handing `compute()` pre-parsed rows carrying no timing, on which it publishes **462 s for a 60 s
record (7.7×)** beside a `startEpochMs` of **`null`** — every other field honestly says *unknown* and
this one alone invents a number. That is Clock Contract §2.6 one layer up.

**Not fixed here, deliberately, and this is a judgement worth stating rather than burying.** Removing
it is a compute-path change (`motiondex-dsp.js` is inside the closure, so `computeHash` moves and
fixture re-verification is owed) on a branch **no input reaches**, and `durSec` feeds `bodyPosition` /
`actigraphy` / `respiratoryEffort`, so the honest replacement is not a one-liner: returning `0` or
`null` changes three windowing denominators. Patching that into a closing pass would be the exact trade
§7.2 spends a section arguing against, made blind. **Routed** to
`NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-2026-08-06-BRIEF.md` §1 with this measurement attached.

**Gated** — `motiondex-dsp · export · duration-semantics`, 6 assertions, pinning the invariant that is
true and must stay true: a stream that carries timing is **measured**, never assumed. The fixture runs
at 200 Hz (the corpus p95) so the measured and fabricated answers are 7.7× apart and cannot be confused
for rounding. **Mutation-verified:** making `durationOf` return `rows.length / 26` unconditionally reds
3 assertions by value (`durSec=462s · measured=60.0s`), including the one that follows the value into
`recording.durSec`.

### 8.3 · What this brief is not claiming

- **Not** that the remaining six nodes publish `endEpochMs`. They do not, on purpose (§7.3); the
  Integrator's `normalizeFile` falls through to `durSec`/`durationMin`, so absence costs nothing today.
- **Not** that PpgDex's `durSec` is *exactly* `recordedSec`. It is a gap-filled grid length that tracks
  it to 0.05 % of span; where a consumer needs the exact figure, `coverage.recordedSec` is the field
  that answers, and it is already published on every file that has a hole.
- **Not** that MotionDex's fallback is safe. It is unreachable through the shipped parser on 616 files,
  and wrong by up to 7.8× if reached. Those are different statements and §8.2 makes both.
- **Not** a re-measurement of the 43 PpgDex files where `t0 + durSec` overruns the last stamp by up to
  24.9 s (0.26 % of span — an `fs`-estimate residual on contiguous Verity records, not a semantics
  question). Recorded in the follow-up §2; it is the reason `endEpochMs` is read rather than derived.
