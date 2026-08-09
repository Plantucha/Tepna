<!--
  DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-05 · **Follows:** `DEEP-AUDIT-V-2026-08-04-BRIEF.md` (PROPOSED) · `DEEP-AUDIT-IV-2026-08-04-BRIEF.md` (PROPOSED)

# Fixing the audit found a 94-label class, and it needs THREE decisions, not one

Six `DEEP-AUDIT-IV`/`V` items shipped (PRs #948 · #949 · #955 · #956 · #957 · #958). Executing them
turned up things the audits did not have — including two defects the briefs never named, and one
population that must NOT be auto-fixed. This brief records the residue.

---

## 1 · The evidence-badge debt is 94 labels, and they are not one problem

`DEEP-AUDIT-V` filed F1 (OxyDex `Mean`/`Min`), F2 (HRVDex table columns), F3 (MotionDex legend) and
F14 (ECGDex `PLV surge vs base`) as four separate badge defects. They are **four samples of one
class**, and the class is bigger than the audit could see, because the audit's gate only scanned
string literals passed to `evBadge` — while most surfaced numbers reach a badge one layer up, through
the render helpers (`metric()`, `kpi()`, `ssKPI()`, `nrChip()`, `chartTitle()`), which badge their
FIRST argument.

Extending the same offender condition (`!idForLabel(label) && badgeForLabel(label,true)`) to those
call sites, measured on the tree at 2026-08-05:

| helper | count | what it actually is |
|---|---|---|
| `metric()` | **55** | genuine per-metric tiles — **real registry-row debt** |
| `ssKPI()` | **7** | ditto |
| `nrChip()` | **6** | ditto |
| `chartTitle()` | **24** | chart CAPTIONS — a different question entirely |
| `row()` | **2** | the emoji column heads `🔗` / `💨` — not metrics at all |
| | **94** | |

**Three decisions, not one:**

1. **The 68 metric tiles** (`metric`/`ssKPI`/`nrChip`) need registry rows. This is the real debt, and
   it is **the owner's call**: writing 68 rows means asserting 68 evidence tiers, and a tier is a
   claim about how well a number is established. Assigning them mechanically to turn a gate green
   would be exactly the fabricated authority §🎫 exists to prevent — the same error
   `DEEP-AUDIT-III §6.5` corrected when it retiered `hypoxicBurden` off a citation that did not match
   the method. **They were deliberately NOT auto-fixed.** 92 of the 68+24 are OxyDex research/accordion
   descriptors; 2 are CPAPDex.
2. **The 24 chart captions** are not per-metric labels — *"SpO₂ Mean % · T95% Time Below 95%"* spans
   TWO metrics and cannot carry one tier. Options: (a) route `chartTitle` through a per-series badge
   rather than a per-title one; (b) deny-list titles and badge the series in the legend instead;
   (c) accept an unbadged caption as long as every SERIES it draws is badged. **(c) looks right** and
   is the cheapest, but it needs stating in `CLAUDE.md` §🎫 — the coverage mandate currently names
   "chart-or-graph series", which arguably already settles it, and if so these 24 are not debt at all
   and the cap should drop to 70.
3. **The 2 emoji heads** belong in `_META_DENY` — they are icons, not measurements. Trivially fixable
   and the only part of the 94 that is unambiguous.

**Meanwhile the debt is RATCHETED, not ignored** (`tests/dex-tests.js`, `no-fabricated-tier`):
`KNOWN_UNREGISTERED = 94`, may shrink, never grow. A 95th label reds immediately, and a second
assertion reds if the debt falls well below the cap without the cap being lowered, so the ratchet
cannot go slack. **Lower the cap as each decision above lands.**

⚠️ **F2 and F3 are NOT closed by #958.** They are members of this class. F2 (HRVDex's 21 unregistered
table columns) additionally sits behind a *fourth* mechanism — its columns come from a `TABLE_COLS`
array, so they are neither literals nor helper first-arguments and **no scan in this repo currently
sees them**. F3 (MotionDex/GlucoDex legends) emits no badge at all, so it is invisible to a
fabricated-tier check by construction: an ABSENT badge and a FABRICATED one need different gates.

---

## 2 · Two defects the audits did not name, found while fixing

**2.1 · `computeSleepStabilityScore` had a correct fix that could never fire** (shipped in #949).
Its §3 branch nulls the motion sub-score when `stats.motionPct == null` and renormalizes — but it was
CALLED ~30 lines above the block that sets that null. On the real 592-row stuck file it scored **0**
(the worst possible) where its own comment says `null`; on a Motion-less file, **100**. This affected
the pre-existing `_motionStuck` path, not just the absent-column path introduced by F15. *An ordering
bug can make a correct fix invisible, and no test caught it because both fixes were asserted at the
function level, never through `processNight`.*

**2.2 · `idForLabel` had TWO resolution gaps, not one** (shipped in #957 and #958). It lowercased
before checking, so a camelCase registry id never matched (6 tokens, incl. CPAPDex's `residualAHI` and
`usageHours` — `measured`, rendered `experimental`); and it never consulted the entries' own `label`
field, so `OXY_REGISTRY.meanPi`, whose label is literally `'Perfusion Idx'`, did not resolve from that
exact string. **The gate reported green over both** because it asked a raw `REGISTRY[tok]` lookup
instead of the resolver the runtime uses.

---

## 3 · Corrections to `DEEP-AUDIT-V`'s own fix sketches

| brief said | reality |
|---|---|
| F11: "gate `route()` on `DexIngest.nonSignalName()`" | **Not callable** — `nonSignalName` is not on the `DexIngest` export surface (`dex-ingest.js:450`), and `route()` is CORE so it must not take an upward dependency on node-ingest routing. Fixed in the adapters instead (#948). |
| F22: "`crcIdx = null`" alone | Insufficient — the whole Cross-Signal render block was gated on `crcIdx != null`, so nulling it would ALSO have hidden AAI, PB Diverge and Diverge %, three valid measurements. The refuter's correction (move the gate to `if (n.cross)`) was load-bearing (#949). |
| Tier 2.1 "the cheapest correctness-adjacent item" | **Not cheapest.** Shipping `DexClock` into `WORKER_SRC` via `Function.toString()` needs the whole dependency closure plus a new drift gate (the `ppgdex-dsp.js` precedent is ~40 lines of hand-maintained `deps` + `consts` with its own "worker source is CLOSED" gate). Still correct, just not small. **Deferred, not done.** |

---

## 4 · Still open from `DEEP-AUDIT-V`

**Tier 1:** F17 (O2Ring drawn-axis `timingSource` — also requires retracting `O2RING-SYNTHESISED-AXIS §5`,
`WEARABLE-HOST-AXIS-FOLLOWUPS §F1` and `PAT-PROXIMAL-DISTAL-PAIR §2/§2a`) · F12 (PpgDex gyro unit
oracle — **§4.7 flags its headline magnitudes as needing independent reproduction BEFORE it drives a
DSP edit**) · F16 (PulseDex present-gates) · F4/F5 (Integrator TCH: the discarded AMBIGUOUS verdict and
the collapsing corner labels) · F7 (longitudinal sleep-date join) · F13 (PpgDex `hostAxis.independent`
dropped at the export boundary).

**Tier 2:** F20+F21 (ECGDex worker clock, see §3) · F8 (coupling bout-clustering — **validate against a
real OSA stream first; the trio corpus is a healthy sleeper**) · ~~F19~~ **F18** (capture-host `_PPI.txt` layout) — **LANDED 2026-08-05 as #961**, before this brief was written; the number was also wrong (F19 is `accFs`, F18 is the PPI layout). Found INDEPENDENTLY from the producer side while auditing `capture-host/writers.py` against the vendor corpus: 7 of 8 stream headers match a real Polar Sensor Logger export byte-for-byte and PPI did not. Same mechanism as F18 names, reached through a different consumer (`sigma-no-reference-analysis.js intervalMap`, not `parseDevicePPI`) — the interval sanity band rejects a ~1e15 device clock, so a LIVE stream reads as zero beats. 21 871 real rows were affected on the box. Nothing left to do here.

**Tier 3:** §1 above.

**Tier 4 (coverage, not fixes):** the browser lane — still run by NOTHING, including all 36 agents of
audit V and every fix PR since · `tools/mutate.mjs` and `mutmut`, never invoked in either language ·
the E2E fold (`trio-batch` → `tch-multinight`) · `cohort-worker.js` (644 lines, zero test-group
mentions, the engine behind four shipped analysis pages).

---

## 5 · What executing six fixes actually taught

Every one of the six was verified RED by value before landing, and **two of the six turned out to be
bigger or differently-shaped than the audit that filed them** (§1, §2.2). That is the argument for
executing findings rather than filing them: a finding is a hypothesis about a defect's *shape*, and
the shape is only settled by fixing it.

The other lesson is procedural and cost real time: `npm run check | tail -25` reports **`tail`'s**
exit code. A gate that had FAILED at `verify:analysis` read as green — `CLAUDE.md` §4b, walked into by
the same session that had just written that section into an audit brief. Capture `$?` of the command
itself; never read a verdict off a truncation.

---

## F12 — REFUTED by measurement (2026-08-08). Do not ship the unit conversion.

F12 carried its own instruction — *"the headline magnitudes come from one hunter with one confirming
reader — **reproduce before this drives a DSP edit**"* (§4.7). Reproduced, on every IMU file in the
corpus rather than on one night. **The load-bearing half does not survive.**

| stream | files | declared unit | measured magnitude | verdict |
|---|---|---|---|---|
| ACC | 113 | `X [mg]` | median-of-medians **994.95 mg** (958–1062) | correct — 1 g at rest |
| GYRO | **61** | `X [dps]` | p50 **4–37**, p99 25–174, max **231–350** | correct — **dps**, not LSB |
| MAG | 57 | `X [G]` | median **0.93** | Gauss (≈93 µT); plausible indoors |

Every one of the 61 GYRO files declares `[dps]` in its header, and **not one file anywhere in the
corpus has `max|gyro| > 2000`** — the tell that would be unmissable if the column were raw LSB at
16.384 LSB/dps. Under the LSB hypothesis the real motion of a sleeping arm would be p50 ≈ 0.3 dps and
max ≈ 21 dps, which is not arm movement. The claim of "543 real corpus files in raw LSB" does not
reproduce; there are 61 GYRO files in total.

### The repro was real, and it measured something else

`analyzablePct 20 → 66` is not in dispute. What it shows is: dividing an already-dps column by 16.384
drives the gyro term to ≈ 0, and **a term that is ≈ 0 is a term that has been removed.** The brief
recorded the discriminator itself and read past it — the no-gyro control gives **68 % / 100.4 ms**
against the "fixed" **66 % / 99.2 ms**. Those are the same number. The conversion did not correct the
gyro; it deleted it.

Read forward instead: with p99 reaching 174 dps against a `v/40` dps normaliser, ordinary arm movement
saturates the gate, so the gyro rejects epochs that carry usable PPG. **The defect is the THRESHOLD,
not the unit** — which is why removing the gyro entirely (68 %) beats keeping it (20 %). That is a
real finding and it is now the open item; it needs a threshold justified against the measured
distribution, not a scale factor.

### What was NOT shipped, and why

No DSP edit. Applying the conversion would take a correctly-scaled column and make it wrong by 16×,
in the confident-looking way that is hardest to find later — and it would have shipped with a green
suite, because nothing gates the *unit* of an input. Fix `(a)` (porting `streamKindFromHeader` +
`xyzPlausible`) is still worth having as a guard against a future file that genuinely differs, but the
brief already labels it *"a no-op for the headline"*, and with `(b)` refuted it should be filed on its
own merits rather than as a fix for this.

**This is the second claim in this audit killed by measuring the corpus instead of one night** (§3
killed the near-identical `accFs` claim on the "effective" wording; F19 survived only because the
surfaced KPI and the export field were checked and say plain `ACC Hz` / `accFs`). The pattern worth
keeping: a repro that improves a headline is not evidence of the mechanism you assigned to it.
