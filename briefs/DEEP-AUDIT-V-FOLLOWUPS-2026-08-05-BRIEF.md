<!--
  DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (deferred 2026-09-05 — no open software item; two OWNER calls remain: §1's three evidence-tiering POLICY decisions, and the NSRR DUA that F8 needs. Verified 2026-09-05: `no-fabricated-tier` 10/10 with `KNOWN_UNREGISTERED = 0` and the not-slack leg passing, so the 94-label backlog is discharged and the tiering calls are no longer urgent; F8's reader is already built and `--selftest`-green, so the DUA is the whole remaining cost. IN-PROGRESS claimed a session was on it and none is) · **Prior stamp:** IN-PROGRESS — 2026-08-15 (§4 RE-MEASURED: eight of its nine "still open" items are closed, F8 alone remains and is data-blocked. §1's three decisions are OWNER calls with the `no-fabricated-tier` ratchet holding meanwhile; §4 Tier-4 coverage debt RE-MEASURED 2026-08-20 — **3 of its 4 items are STALE**; only `cohort-worker.js` survives, and it is the row a grep count would have wrongly cleared) · **Created:** 2026-08-05 · **Follows:** `DEEP-AUDIT-V-2026-08-04-BRIEF.md` (DONE — 2026-08-15) · `DEEP-AUDIT-IV-2026-08-04-BRIEF.md` (IN-PROGRESS) · 🔴 **RE-MEASURED 2026-09-03 — §1's HEADLINE NUMBER IS DISCHARGED. The evidence-badge debt is `0`, not 94.** Read from the gate rather than the prose: `no-fabricated-tier` reports *"0 labels render a tier no registry assigned"*, ⚠️ Its sibling assertion PRINTS *"debt is now 0; drop KNOWN_UNREGISTERED to match"*, and that is NOT a live instruction: `KNOWN_UNREGISTERED` is ALREADY `0` (`tests/dex-tests.js:47444 — the line MOVED from :47032 as the file grew; re-verified 2026-09-05 by `grep -n KNOWN_UNREGISTERED`, which is the durable query, and the constant is still `0``), so the cap is tight and nothing is slack. That string is a detail template the runner prints on PASS as well as on failure. I read it as an actionable and had written exactly that here before checking the constant — corrected in the same session. It is a live instance of residue `2026-09-03-pass-detail-reads-as-absence`, filed hours earlier by me and then walked into anyway, which is the argument for the row rather than against it. §1's three OWNER decisions are about tiering POLICY and remain owner calls; what is gone is the 94-label backlog they were framed around, so they are no longer urgent. **§4: F8 alone survives and is DATA-blocked** — it needs a real OSA stream and the trio corpus is healthy sleepers, so no amount of software work discharges it. Net: this brief has NO open software item; it waits on one owner policy call and one recording. · **RE-VERIFIED 2026-09-05 (Brief runner):** §1's discharge HOLDS — `no-fabricated-tier` green 10/10, *"0 labels render a tier no registry assigned"*, `KNOWN_UNREGISTERED = 0` and the not-slack leg passes, so the cap is tight. §4/F8 remains the only survivor and is still DATA-blocked (a real OSA stream; the trio corpus is healthy sleepers), so no software work discharges it. No open software item — unchanged from the 2026-09-03 stamp.

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

   > ✅ **DECIDED 2026-08-16 — owner chose (c), and it is implemented.** `CLAUDE.md` §🎫 now states the
   > corollary explicitly (*an unbadged caption is correct provided every series it draws is badged*),
   > `no-fabricated-tier` no longer scans `chartTitle`, and the ratchet is **70**. The 24 were
   > **measured, not assumed**, before the cap moved: instrumenting the gate by helper gave
   > `row 2 · chartTitle 24 · metric 55 · ssKPI 7 · nrChip 6 = 94`, so removing captions lands exactly
   > on 70 — and both ratchet assertions (does-not-grow, and not-slack) pass at that value rather than
   > merely the first one. They were never debt.
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

## 4 · Still open from `DEEP-AUDIT-V` — RE-MEASURED 2026-08-15, and almost none of it is

This section listed nine items as open. **Eight are closed**; one is data-blocked. Verified by reading
the code each cites, not by trusting a status header — the parent brief now carries the same sweep.

| item | state 2026-08-15 | evidence |
|---|---|---|
| **F17** O2Ring drawn-axis `timingSource` | **DONE** | `ppgdex-dsp.js:564`, `:675` |
| …and its three retractions | **ALL LANDED** | `O2RING-SYNTHESISED-AXIS` §3 · `WEARABLE-HOST-AXIS-FOLLOWUPS` *"RETRACTED IN PART — DEEP-AUDIT-V §2.7 F17"* · `PAT-PROXIMAL-DISTAL-PAIR` §2a *"PROVENANCE CORRECTION"* |
| **F12** PpgDex gyro unit oracle | **REFUTED** | this brief's own §F12 — do not ship it |
| **F16** PulseDex present-gates | **DONE** | `pulsedex-dsp.js:241` — *"AN UNCOMPUTABLE INDEX IS `null`, NEVER 0"* |
| **F4** TCH AMBIGUOUS verdict | **DONE** | `integrator-dsp.js:2613` — *"THE SCREEN HAS THREE OUTCOMES; THIS IMPLEMENTED TWO"* |
| **F5** collapsing corner labels | **DONE** | `integrator-tch.js:318` |
| **F7** longitudinal sleep-date join | **DONE** | `integrator-longitudinal.js:231` |
| **F13** `hostAxis.independent` dropped at the export boundary | **DONE** | `ppgdex-dsp.js:696` |
| **F20+F21** ECGDex worker clock | **DONE** | `ecgdex-app.js` — and by a *better* route than either brief prescribed (see §3) |
| **F18** capture-host `_PPI.txt` layout | **LANDED** #961 | already recorded below |
| **F8** coupling bout-clustering | **OPEN — data-blocked** | needs a real OSA stream; the trio corpus is a healthy sleeper |

**F8 is the only Tier-1/Tier-2 item left, and it is not waiting on code.** It waits on a recording this
machine does not have, which is a different kind of open from the rest of this list and should not be
ranked beside them.

### …and it waits on the SAME recording as `REM-STAGING-FOLLOWUPS` §2b — measured 2026-08-15

Two independent briefs, one dependency, and neither named the other until now.

**Why the local corpus structurally cannot supply it.** The committed CPAP night carries **20 events —
13 apnea, 7 hypopnea** (`uploads/cpapdex-2026-06-12.node-export.json`). That is what effective therapy
looks like, and it is why "the trio corpus is a healthy sleeper" is a claim about the RECORDINGS rather
than about the subject. F8 asks whether the coupling statistic survives events arriving in **bouts of
5–20 min**; twenty events across a night can neither exhibit nor refute bout structure at any useful
power. **The blocker is statistical, not instrumental** — and collecting untreated nights is a clinical
decision, not an engineering one, so it is not a data-collection step this brief may propose.

**The reader F8 needs is ALREADY BUILT, which changes the economics.** `REM-STAGING-FOLLOWUPS` §2a
rebuilt `nsrr-adapter.js` for expert sleep staging — and it parses **respiratory events too**, not only
stages:

```
nsrr-adapter.js:228   var kind = HYPOP_RE.test(concept) ? 'hypopnea' : APNEA_RE.test(concept) ? 'apnea' : 'resp';
```

plus `tools/nsrr-stage-validate.mjs` (21 KB, `--selftest`-proven against a synthesised EDF + profusion
XML, no records required). So the marginal cost of F8 **after** a DUA is a diagnostic, not an ingest
pipeline.

**Consequence for whoever weighs the NSRR DUA: it unblocks two briefs, not one, and the second arrives
with its reader already written and tested.** Neither brief makes that argument on its own, because
neither could see the other.

⚠️ **A stale "still open" list costs more than a stale DONE.** A reader who trusts this section spends a
day re-fixing eight closed findings, and the eight were closed *by people who then did not come back to
update the list they were working from*. That is the same asymmetry `truncation-fabricates-disproofs`
names: a false green is eventually caught by the thing it gates, a false "there is work here" is caught
by nobody.

**Tier 3:** §1 above.

**Tier 4 (coverage, not fixes):** the browser lane — still run by NOTHING, including all 36 agents of
audit V and every fix PR since · `tools/mutate.mjs` and `mutmut`, never invoked in either language ·
the E2E fold (`trio-batch` → `tch-multinight`) · `cohort-worker.js` (644 lines, zero test-group
mentions, the engine behind four shipped analysis pages).

> ### ▶ TIER 4 RE-MEASURED 2026-08-20 — **3 of 4 are STALE**; only `cohort-worker.js` survives
> ### ▶ **AND THAT LAST ROW CLOSED 2026-08-23 — Tier 4 is fully resolved.**
>
> This list is the sibling of §4's own warning two paragraphs up — *"a stale 'still open' list costs
> more than a stale DONE … a false 'there is work here' is caught by nobody."* It has been costing that
> since 2026-08-05.
>
> | item | verdict | evidence |
> |---|---|---|
> | browser lane "run by NOTHING" | **STALE** | run 2026-08-20 against a served checkout: `✓ browser gates passed`, **7584 passed · 52 skipped · 533 groups**, 9 bundles + 31 fixtures audited. And it is not even manual — `browser-gates.yml` installs playwright + chromium and runs exactly it, as **one of the eight REQUIRED status checks**, so it has gated every PR for months |
> | `mutate.mjs` / `mutmut` "never invoked in either language" | **STALE, both** | JS: `.git/tepna-mutation/` holds **16 ledgers and 9 draft banks** (cpapdex, ecgdex, …) plus `*.operators.done.json`; three PRs this week fix `mutate.mjs` internals (#1575 · #1579 · #1580). Python: `capture-host/mutation_triage.py` ships, and the runbook commits — *"`--list` before `--only`"*, *"the survivor-set diff UNDERCOUNTS kills"* — are lessons only obtainable by **running** mutmut |
> | E2E fold `trio-batch` → `tch-multinight` | **STALE** | `tch-multinight --dir` run over **55 nights** on 2026-08-20; the run also found its real-data path had been dead since #1418 (`ReferenceError: prov is not defined`), fixed in **#1595** |
> | `cohort-worker.js` zero test-group mentions | **UPHELD 2026-08-20 → CLOSED 2026-08-23** | gated by `cohort · worker · realm`: the `pulse` KIND boots in a `node:vm` reconstruction, runs a job and returns 9 scored nights. The two load-bearing assertions are that `ready` carries NO `err` — a boot failure is a FIELD on an otherwise identical message, which is how a KIND broke silently before (`cohort-worker.js:124`) — and an unknown-KIND control proving that contract can report failure at all. **Tier 4 is now 4 of 4 resolved.** |
>
> ⚠️ **The upheld row was nearly mis-scored, and the near-miss is the transferable part.**
> `git grep -c cohort-worker -- tests/` now returns **1**, which reads as "covered". The hit is **prose
> inside a comment** in the *qrs-yield* group, explaining why cohort-worker is a **documented gap**
> (*"KIND-parameterized … materially heavier + lower value; left as documented gaps"*). A grep proves a
> string occurs, never that a symbol is exercised — so the one row that survives is the row a count
> would have wrongly cleared, and the three that fell are rows a count would have wrongly kept.
>
> **F8 above is UNAFFECTED and remains correctly blocked** — it needs untreated OSA nights, the
> committed CPAP night carries 20 events (13 apnea / 7 hypopnea), and that is a clinical decision, not
> an engineering one. Nothing here touches it.
>
> ⚠️ **CLOSING IT REPRODUCED THE NEAR-MISS ONE LAYER DOWN, WHICH IS WORTH MORE THAN THE ROW.** While
> building the gate I found `cohort-regression.js` reading `m.error` where every WORKER posts `m.err`,
> concluded its boot guard was structurally dead, changed it, and wrote a scan for the class. All of
> that was wrong: `cohort-regression.js` boots `cohort-harness.html` **IFRAMES**, and that harness
> posts `error` (`cohort-harness.html:172-174`). The "fix" would have turned a WORKING guard into a
> dead one — the exact defect being hunted, inverted.
>
> Two channels share one message type: **workers** post `err` (`cohort-worker:627`,
> `qrs-equiv-worker:172`, `qrs-yield-worker:379`, `pat-feasibility-worker:407`), the **iframe harness**
> posts `error`. Consumers correctly match their own producer, and `qrs-equiv-analysis.js` reads BOTH.
> It reads as an inconsistency and is not. The row above says a grep proves a string occurs, never that
> a symbol runs; this adds the sibling — **a message SHAPE does not identify its producer. Trace the
> channel.** Recorded beside the new group in `tests/dex-tests.js` as well, where it will be read.

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

### …and the THRESHOLD reframing does not survive either (same day, measured)

The F12 entry above proposed a successor finding — *"the defect is the THRESHOLD, not the unit"* — on
the reasoning that p99 gyro of 174 dps against a `v/40` normaliser must saturate the gate. **That was
reasoning from a whole-file percentile to a per-cell one, and it is wrong.** The grid takes a
per-cell PEAK over `dt`, so the quantity that matters is the distribution of per-cell peaks, not of
raw samples.

Measured on the 10 nights that have paired ACC+GYRO, at the per-1 s-cell 95th percentile, expressed as
the gyro full-scale that would make the gyro leg agree with the ACC leg's own `v/120` mg:

| night | acc p95 | gyro p95 | equivalent gyro full-scale |
|---|---|---|---|
| 06-13 | 47.6 mg | 4.8 dps | 12.1 dps |
| 06-15 | 39.1 | 6.7 | 20.6 |
| 06-19 | 42.5 | 4.7 | 13.2 |
| 06-20 | 12.3 | 13.3 | 129.8 |
| 06-20b | 42.7 | 10.0 | 28.0 |
| 06-21 | 84.6 | 33.1 | 47.0 |
| 06-28 | 37.6 | 4.7 | 15.0 |

Median **21 dps**, i.e. **BELOW the 40 dps in use**. At 40 the gyro leg is *less* sensitive than the
ACC leg, so on a typical night it does not saturate and does not dominate `max(accNorm, gyNorm)` — the
ACC does. The threshold is not obviously wrong, and if anything it is conservative. **No change made.**

### The repro night does not exist in this corpus

F12's headline is *"a real 2026-07-18 Verity night"*. The Verity GYRO nights available here run
**2026-06-09 → 2026-07-13** — 32 dates in the PSL tree plus 2 in `uploads/`. There is no 07-18 Verity
recording; the only 2026-07-18 data is CPAP. So neither the original claim nor my successor to it can
be checked against the night that produced `analyzablePct 20 → 66`.

**What would settle it** is either that night's files, or a corpus-wide `analyzablePct` computed with
and without the gyro leg across the 10 paired nights — a measurement, not another reading of the same
summary. Until one of those exists, `v/40` stays.

I am recording my own wrong turn here rather than quietly dropping it, because it is the same error as
the finding it was replacing: a plausible mechanism attached to a real number, asserted without
measuring the quantity the code actually uses.
