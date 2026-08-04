<!--
  NODE-EXPORT-DURATION-SEMANTICS-2026-07-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-04 · **Created:** 2026-07-27 · **Follows:** `NODE-EXPORT-RECORDING-DURATION-2026-07-24-BRIEF.md` (which asked whether a node declares a length at all; this one asks what it MEANS) · **Decision:** owner-ratified 2026-07-27 (option (c)) · **Builds-on:** `DEEP-AUDIT-III-2026-07-26-BRIEF.md` §6.2 (`recording.coverage`, landed `986d17e`) · **Relates:** `INTEGRATOR-GAP-AWARE-OVERLAP-2026-07-27-BRIEF.md` (§5 — the coverage model this ruling completes), `CAPTURE-HOST-INTEGRATOR-FOLD-2026-07-24-BRIEF.md` (added the `durSec` key whose meaning this pins down)

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
- [ ] `bump: minor` — the export gains a field. The ECGDex-only step is already `minor` for that reason.
- [ ] Per node: regen goldens, re-bundle, `build.mjs --check`, `verify-manifest.mjs` GATE A+B, and — since `computeHash` moves — `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`.


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
