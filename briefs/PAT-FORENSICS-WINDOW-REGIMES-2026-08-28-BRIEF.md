<!--
  PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (item 1 EXECUTED 2026-09-14 — the clock-offset hypothesis is TESTED and its verdict is NOT STABLE across two 80%-overlapping trees, see §8.6 before quoting §8.2. The instrument it needed was already committed. Item 2 remains open and its proposed 200-500 ms rail is the WRONG ANATOMY - read §8.5 before building it.) · **Residue:** 2026-09-14-phys-rail-is-arm-band-on-an-ankle, 2026-09-14-regimes-item1-verdict-not-stable · PROPOSED (parked 2026-09-06 — dependency satisfied since #2029/#2034, but both remaining items need instruments that do not exist yet. Blocker in §-park) · ****RE-STAMPED 2026-09-05 (Papers) — PROPOSED (core UNBLOCKED, remainder unexecuted; verified 2026-09-05).** The 09-01 stamp said this brief waits on oracle output that had never been produced. **That dependency is now satisfied**: #2029 and #2034 produced corpus-wide oracle verdicts over 43 box nights (4 SIGNAL RECOVERED / 20 PARTIAL / 5 NO RECOVERY / 0 UNDEFINED), so the regime split is now readable. Nobody has executed it. ⚠️ ORIGINAL 09-01 STAMP, superseded: TRIAGED 2026-09-01 (Osprey): not independently executed this pass. Shares the WINDOW-ORACLE dependency — the regime split is read off oracle output, which had never been produced against a corpus. That is now executable locally; see that brief's corrected stamp.** · **Created:** 2026-08-28 · **Parent:** `PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md` (§12 oracle · §16 gate self-selection · §17 corpus table) · **Interlocks:** `PAT-FORENSICS-FIDUCIAL-JITTER-2026-08-28-BRIEF.md`, `PAT-FORENSICS-AXIS-LEG-ASYMMETRY-2026-08-28-BRIEF.md` · **DRAIN 2026-09-02 (Osprey):** re-verified — still gated on WINDOW-ORACLE output, which is exactly what this drain's oracle re-run (post-#2082 fragment pairing) supplies. **Owner: Osprey. Next step:** read the regime split off the new oracle output once that run's results land in the WINDOW-ORACLE brief; do not re-run the oracle for it. · **SWEEP-FOLD 2026-09-03 (Osprey) — the dependency is not merely unrun, its INPUT has moved.** This brief's regime split is read off WINDOW-ORACLE output, and the sweep measured that output's published tables diverging (§6 withdrawn as circular, real result 7 of 9 cells moved; drift table 5 of 8 rows) under my #2114 picker fix. So the split does not merely await a corpus run — **any regime boundary quoted from the pre-#2114 oracle rests on numbers that have since changed.** Unchanged otherwise since the 2026-09-01 triage. Owner: Osprey. **Next step:** unchanged — take the split from a POST-#2114 oracle run, and do not carry forward a boundary derived from the published tables.

# PAT clears its own bar on 1 night in 42 — and the failure is the acceptance window, not the sensors

> **In one line:** across the full 42-night capture-host corpus, the accepted-PAT distribution falls
> into four regimes. **37 % is window-dominated** — its SD is a constant of the estimator carrying no
> signal — **11 % is edge-loaded worse than uniform**, 48 % is intermediate, and **3.7 % (one night)
> resolves below the 60 ms bar**. Every sensor-side term measured in this campaign is ≤ 11 ms.

## 1 · ⚠️ How this brief was corrected, and why that is recorded first

An earlier form of this result claimed the distribution was **universally** window-dominated and that
PAT *"cannot clear a 60 ms bar on any hardware."* **Both were wrong**, and the error was not in the
measurement but in reading it: the run was piped through `tail -40`, so the rows that survived were
the last few, and they happened to be the ~129 ms cluster. CLAUDE.md §4b names exactly this — *a
verdict read off a truncation* — and it was committed three flags deep into a campaign whose other
findings include three separate proxy-field versions of the same family.

**The re-run without the pipe falsified the claim in both directions**, which is why the tail is
dangerous rather than merely lossy: the hidden rows contained **nights below the bar** (the most
informative rows in the corpus) and **nights above uniform** (a distinct mechanism). A truncation
does not degrade a result uniformly; it removes the tails, and the tails are where the discriminating
cases live.

## 2 · The measurement

`tools/pat-per-led.mjs` over `/home/michal/tepna-smoketest/captures`, **all 42 night directories, no
filter, no pipe**. Each Verity LED is scored standalone against the ECG R-peaks — no consensus, no
channel ranking — so a night contributes up to three independent channel-rows.

```
nights seen 42 · channel-rows WITH PAT 81 · zero-yield rows 36 · too-few-feet 4 · missing-stream nights 2
PAT SD:  min 36.4   median 121.4   max 156.6 ms
```

⚠️ **36 zero-yield rows against 81 yielding ones.** Roughly **30 % of attempted channel-rows produce
no PAT at all**, and every statistic below is conditioned on the survivors. That is a §16 selection
effect of the first order and no reading of this table is valid without it.

## 3 · The four regimes

Bands, and their provenance — **both endpoints are principled, not fitted**: 60 ms is the gate's own
`DRIFT_MAX_MS`; 129.9 is `450/√12`, the SD of a *uniform* distribution on the acceptance window
`[PHYS_LO, PHYS_HI] = [200, 650]`, with a ±5 % tolerance. *(Honest caveat: the band set was written
after glimpsing a 17-night partial, so it is pre-stated relative to the full run but not to the first
17 nights.)*

| regime | band | channel-rows | share |
|---|---|---|---|
| **SUB-BAR** | SD < 60 ms | **3** | **3.7 %** |
| INTERMEDIATE | 60 – 123.4 | 39 | 48.1 % |
| **WINDOW-DOMINATED** | 123.4 – 136.4 (129.9 ±5 %) | **30** | **37.0 %** |
| **EDGE-LOADED** | > 136.4 | **9** | **11.1 %** |

- **WINDOW-DOMINATED** — SD indistinguishable from `450/√12`, median on the window midpoint (425.0).
  The pairer is accepting whichever foot lands in the window; the distribution *is* the window and the
  reported SD is a constant of the estimator.
- **EDGE-LOADED** — SD **above** 129.9, which no uniform distribution on a 450 ms interval can
  produce. It requires mass at both edges: the **bimodal signature of a censoring cut**, and therefore
  positive evidence for the mechanism §8/§16 predicts rather than noise.
- **SUB-BAR** — one night (2026-07-31), all three channels, **SD 37.2 ms at a median lag of 275 ms**.
  Tight, off-centre, and physiologically plausible. **PAT is measurable here.**

## 4 · What sets the regime — three explanations eliminated

| candidate | verdict | evidence |
|---|---|---|
| channel/signal quality | **ELIMINATED** | foot-to-foot SD median is **95–109 ms across all four regimes** — flat |
| a per-channel property | **ELIMINATED** | all 3 LEDs agree on the regime on **every** night, without exception |
| median-lag position in the window | **ELIMINATED** | 2026-08-01 sits **7 ms** off centre and is EDGE-LOADED (156.6); 2026-08-03 sits **exactly** on centre at 125.1 |
| yield | **ELIMINATED** | 12 % – 54 % spans every regime |

**The regime is a NIGHT-level property that is not explained by the PPG signal.** That is a positive
structural result: whatever selects the regime acts on the whole night and upstream of the optics.

**The leading untested candidate is the inter-device clock offset.** It is night-level by
construction, and #1879/#1880 measured per-connection BLE offset drift at median **43.8 ms**, p90
142.9, max **815.6 ms** — large enough to move the true R→foot lag across, or entirely out of, a
450 ms window. **Untested here**, and named as the next experiment rather than asserted.

## 5 · Labels (charter §19)

- **Window-domination: STATISTICAL / GATING DESIGN (mechanism 11), FUNDAMENTAL for this estimator,
  NOT for the devices.** §19 forbids fixing a fundamental limit with aggressive gating — and here the
  gating *is* the limit. Every sensor-side term measured: ECG axis 11.15 ms, PPG fractional-subscript
  bug ~10 ms, fiducial jitter ≤ 6.3 ms by two independent routes.
- **Edge-loading: the censoring cut, ENGINEERING.** Same window, seen from the other side.
- **The 3.7 %: existence proof.** PAT is not impossible on this hardware — it is achieved.

## 6 · What this does NOT establish

- **Why a night lands in a regime.** Four candidates eliminated, the clock-offset hypothesis untested.
- **That a better window recovers the other 96 %.** The sub-bar night's lag is 275 ms — far from the
  window centre — which *suggests* a mis-centred window, but one night is an anecdote, not a result.
- **Any recommendation.** §20 forbids optimising pass rate and §21G forbids a pre-written conclusion.
  The oracle asks whether a physiologically-anchored pairing recovers signal above the ~11 ms sensor
  floor; that experiment, not this table, decides.


## §-park · PARKED 2026-09-06 — the dependency cleared, the items did not

The 09-05 stamp said this brief waited on oracle output that had never been produced. **That is now
satisfied**: #2029 and #2034 produced corpus-wide verdicts over 43 box nights (4 SIGNAL RECOVERED /
20 PARTIAL / 5 NO RECOVERY / 0 UNDEFINED). The regime split is readable. Both items still cannot be run:

**"Clock-offset hypothesis tested against regime membership"** needs a per-night clock-offset estimate
that is independent of the regime assignment. The oracle's own mode is not it — the mode IS what regime
membership is derived from, so testing one against the other is circular. An independent offset exists
only on nights with a second clock, and the memory `ble-stamp-placement-bounds` records that phone-captured
nights have none (`spreadMs` 0.13–1.00 ms, one stamp quantum). So this is answerable on the box subset
only, and needs the offset computed from `hostAxis` rather than from the oracle.

**"Does a physiologically-anchored window recover signal above the sensor floor?"** is a TOOL change, not
a parameter. `pat-window-oracle` takes `--half-width`, which widens or narrows a search centred on the
recovered mode; a physiologically-anchored window means constraining the MODE SEARCH to a physiological
band (200–500 ms per `PPG-FOOT-PLACEMENT` §4a) so a mode outside it cannot be returned at all. The sweep
already run (w = 50/200/300) does not approximate that — it moves the width, never the admissible centre,
and the five out-of-window modes (25/165/185/815/1245 ms) are exactly what such a constraint would refuse.

**Who unblocks:** item 1, whoever computes a `hostAxis`-derived per-night offset on the box subset;
item 2, whoever adds a mode-search constraint to the oracle — which is also the REFUSED-artifact candidate
already recorded in the sibling brief, so the two should be built together rather than twice.

⚠️ **Parked, not blocked-on-data.**

## 8 · EXECUTED 2026-09-14 (Kestrel) — item 1: the clock-offset hypothesis is SUPPORTED, and the instrument it needed was already committed

### 8.0 · The park was wrong about what was missing

§-park says item 1 needs *"whoever computes a `hostAxis`-derived per-night offset on the box subset."*
**`tools/pat-host-offset.mjs` is committed and is exactly that tool.** Its own header says it "drives
the SHIPPED `hostAxis` rather than the re-implementation §3e.4 scouted with", enumerates every pair
and every non-overlapping window rather than selecting one (§3c.4's circularity), and scores a window
**NOT AT ALL** when `hostAxis` returns `ok:false` or `independent:false`. Nothing had to be built.

This is the ninth item in the current drain where the work existed and the brief did not know. That
rate is a property of how briefs get parked, not nine coincidences — a park is written by the session
that is leaving, which is the session least likely to search first.

### 8.1 · Pre-stated rule (written before any predictor output was read)

- **Predictor** — per night, `dPpm = ppmE − ppmP`, the **inter-device** relative rate. Neither
  device's own ppm is the hypothesised quantity: a common-mode host error cancels in the pairing.
  `driftMs = |dPpm| × 1e-6 × 7200 s`, the offset excursion across one scoring window.
- **Outcome** — per-night PAT SD from `tools/pat-per-led.mjs`, the continuous quantity §3's bands cut.
- **Primary** — Spearman(`driftMs`, PAT SD). SUPPORTED at |ρ| ≥ 0.5 and p < 0.05; REFUTED at |ρ| < 0.3.
- **Magnitude gate, evaluated first and able to refute alone** — if p90(`driftMs`) < 45 ms the
  candidate cannot move a lag across a 450 ms window whatever the correlation says.
- Predictor and outcome measured on **one tree**, never joined across trees.

The predictor never sees a mode, a foot, a lag or a regime, so the circularity §-park names is absent
by construction.

### 8.2 · Result — primary tree `uploads/vigil-archive/captures`

```
nights seen 43 · with a PAT SD 28 · zero-yield 15 · predictor accepted 29 · JOINED 22
magnitude gate  driftMs  min 16.2 · med 93.6 · p90 847.0 · max 17500.7 ms   → passes (not refuted)
PRIMARY         Spearman(driftMs, PAT SD)  rho 0.644  n 22  permutation p 0.0021   → SUPPORTED
```

Robust to the tail: dropping the three nights whose `|dPpm|` is not crystal-plausible (2026-09-04 at
2431 ppm, 09-05 at 322, 09-11 at 118) leaves **ρ 0.607, p 0.0069, n 19**. The verdict is not carried
by outliers.

Regime medians, descriptive only — §3's groups are far too thin here for an omnibus test:

| regime | n | median `driftMs` | median &#124;dPpm&#124; |
|---|---|---|---|
| SUB-BAR | **0** | — | — |
| INTERMEDIATE | 7 | 70.0 ms | 9.7 |
| WINDOW-DOMINATED | 13 | 97.4 ms | 13.5 |
| EDGE-LOADED | 2 | 103.5 ms | 14.4 |

**Replication on the brief's own tree** (`/home/michal/tepna-smoketest/captures`, 49 nights, 32 with a
PAT SD) reproduces §3's structure closely — SUB-BAR 3.1 % / INTERMEDIATE 40.6 % / WINDOW-DOMINATED
46.9 % / EDGE-LOADED 9.4 % against §3's published 3.7 / 48.1 / 37.0 / 11.1 — and names the **same**
SUB-BAR night (2026-07-31, median lag 275 ms). The regimes are a stable property of the corpus, not
of the tree.

### 8.3 · ⚠️ SUPPORTED IS NOT "MECHANISM ESTABLISHED" — two things this cannot separate

**(a) `driftMs` is entangled with PPG signal quality.** Foot-to-foot SD carries no clock at all, and:

```
Spearman(driftMs,  foot-foot SD)   rho 0.439  p 0.043      ← predictor and the rival are correlated
Spearman(foot-foot SD, PAT SD)     rho 0.473  p 0.026      ← the rival also predicts the outcome
Spearman(driftMs,  PAT SD)         rho 0.644  p 0.0021     ← the hypothesis, stronger but not clean
```

The clock beats the optics as a predictor and does not eliminate it. At n=22 neither can be partialled
out of the other. **§4's elimination of "channel/signal quality" was done on medians-per-regime and
read flat (95–109 ms); a rank correlation over nights does not read flat.** Those are two different
statistics and the medians test, over groups of 1/13/15/3, is the weaker one. §4's row should be read
as "not the whole story", not as closed.

**(b) The large `dPpm` values are a LINK figure, not a crystal figure.** CLAUDE.md §🔒 §7 is explicit:
the O2Ring's crystal measures sub-ppm between dropouts and *"a stalled link can manufacture an
arbitrarily large apparent rate"*. 2431 ppm is not a crystal. So on those nights `driftMs` is partly a
name for link quality — and a bad link plausibly degrades the PPG directly. The correlation is real;
the causal arrow is not settled by it.

**(c) The outcome is at a ceiling on 59 % of the joined nights.** 13 of 22 sit within 5 % of
129.9 ms = 450/√12 — which §3 already says *is a constant of the estimator*, not a measurement.
Restricting to nights below the WINDOW-DOMINATED band leaves **n=7, ρ 0.429, p 0.35**: the dynamic
range where the outcome is still informative is too small to test in this corpus. A predictor
correlating with a saturated outcome is the weakest form this result could take and it is the form it
has.

**So: the pre-stated rule returns SUPPORTED and that is reported as the verdict. The mechanism is
not thereby demonstrated.** Recording both is the point — reinterpreting a pre-stated verdict after
seeing the confound would be the failure the pre-statement exists to prevent.

### 8.4 · 🔴 The single informative night is MISSING from the join, and nothing said so

**2026-07-31 — the one SUB-BAR night, PAT SD 36.9 ms at a median lag of 275 ms, the only night in this
corpus where PAT is actually measurable — has no row in the host-offset output and no entry in its
refusal list.** It is one of **14** nights that `pat-per-led` scored and `pat-host-offset` dropped
silently; only 6 refusals over 5 nights are recorded, all with reasons.

That is the §∅ failure one level up: a night that was never evaluated is indistinguishable from a
night that yielded nothing, and the loss landed precisely on the highest-information night. The
SUB-BAR row in §8.2 reads `n=0` for that reason and for no physical one. **Any future run of this join
must reconcile the two tools' night sets and account for every difference before reading a
correlation.** Logged as residue `2026-09-14-host-offset-drops-nights-silently`.

### 8.5 · For item 2 — the proposed 200–500 ms rail is the WRONG ANATOMY

§-park proposes constraining the oracle's mode search to **200–500 ms** per `PPG-FOOT-PLACEMENT` §4a.
`PAT-SENSOR-PLACEMENT-CORRECTION-2026-08-04-BRIEF.md`, written **24 days earlier**, is titled *"The
Verity has ALWAYS been on the left ankle. Every 'arm/wrist' plausibility argument in the PAT family is
against the wrong band."* Confirmed here independently: `pat-per-led` classifies **every** night in
both trees as site `ankle`, and its `RE.ankle` is the Verity regex. The pair is chest→ankle, the
longest peripheral path this hardware has.

That brief further records: *"for an ankle site, landing in the arm band is not a check that passes —
it is one that should raise a question."* Building 200–500 into the oracle would encode into the
**tool** the anatomical error that brief corrected in **prose** — and would let a 215 ms mode pass as
physiological on a chest→ankle path.

There is also a cleaner experiment available than the constraint itself. Median lag over all yielding
nights is **426 ms on both trees**, against a window midpoint of **425**. That is either the true
chest→ankle PAT (406–498 ms is established as plausible for this path) or the estimator returning its
own midpoint — and the two are indistinguishable at `[200, 650]`. **Re-run at a rail whose midpoint is
not 425**: if the reported lag follows the midpoint, the lag is the window; if it stays near 426, it is
physiology. One run, decisive, and it settles item 2's premise before any constraint is built.

## 8.6 · 🔴 CORRECTION, same day (#2490 → this) — the replication leg landed and the verdict does NOT hold

§8.2 committed in advance that *"a replication that disagrees with the primary is reported as a
disagreement, not averaged into one verdict."* It disagrees. This section is that report.

The replication leg of §8.1 — `pat-host-offset.mjs` on the **brief's own tree**,
`/home/michal/tepna-smoketest/captures` — was still running when #2490 was pushed; §8.2 carried only
its *regime* replication, which did hold. The correlation leg finished afterwards:

| | primary (`uploads/vigil-archive`) | replication (**the brief's own tree**) |
|---|---|---|
| n | 22 | 25 |
| Spearman(`driftMs`, PAT SD) | **ρ 0.644**, p 0.0021 | **ρ 0.388**, p 0.0584 |
| pre-stated verdict | **SUPPORTED** | **INCONCLUSIVE** |

**And these are not two samples. 20 of the 25 nights are the same recordings.** The trees differ by
five nights present only in the replication and two only in the primary. Swapping seven nights out of
twenty-five moves ρ by 0.256 and carries the verdict across its own pre-stated boundary.

**One night does most of it. `2026-07-24`: `driftMs` 1151 ms — the third-largest offset excursion in
the corpus — at PAT SD 65.9 ms, the LOWEST SD of any joined night.** It is a direct counterexample to
the mechanism: the hypothesis says a large inter-device offset smears the pairing into the window, and
this night has a large offset and the tightest PAT distribution measured. Leave-one-out confirms it
carries the disagreement — dropping it alone lifts ρ from 0.388 to 0.539.

**The predictor ranking also flips between the trees, which is the deeper problem:**

```
                        primary      replication
Spearman(driftMs, SD)     0.644  →      0.388
Spearman(|ppmP|, SD)      0.561  →      0.736     ← the Verity's own host divergence
Spearman(|ppmE|, SD)      0.144         0.077     ← the H10's: no signal on either tree
```

On one tree the inter-device rate is the better predictor; on an 80 %-overlapping superset the
Verity-vs-host rate is, by a wide margin. **Whatever is real here looks like a property of ONE
device's divergence from the capture host, not of a differential between two devices** — and the
hypothesis §4 names is specifically the differential. `|ppmE|` predicts nothing on either tree, which
is the control that makes this readable rather than a coin-flip between two correlated variables.

### What this does to the Done-when box

**Item 1 stays TESTED and its verdict is now NOT STABLE.** That is not a downgrade from SUPPORTED to
INCONCLUSIVE — it is the statement that this corpus cannot distinguish the two, because a seven-night
change of sample moves the answer across the boundary. §8.3 already said the mechanism was not
established; §8.6 says the *correlation itself* is not established.

⚠️ **The primary/replication split was my choice and it decided the verdict.** §8.1's amendment made
`uploads/vigil-archive` primary for join-exactness. The brief's own tree — the one §2 and §3 were
measured on, and the larger one — is the tree that returns INCONCLUSIVE. Had I launched in the other
order, the same work would have reported the same numbers under the opposite headline. **A verdict
that depends on which of two overlapping trees you happened to start with is a sampling artifact, and
the pre-stated rule is what made that visible rather than a matter of taste.**

**What would settle it** is not more statistics on these nights. Either (a) `2026-07-24` is explained
— a 159.9 ppm night with a 65.9 ms PAT SD is either the counterexample it appears to be or an
instrumental artifact, and `2026-09-14-host-offset-drops-nights-silently` shows this join is not yet
trustworthy enough to assume the former; or (b) the corpus grows enough that seven nights cannot move
the verdict. Logged as residue `2026-09-14-regimes-item1-verdict-not-stable`.

## 7 · Done when

- [x] Full-corpus run, untruncated, all 42 nights, zero-yield rows counted.
- [x] Regimes classified against principled bands; shares reported.
- [x] Four candidate explanations for regime membership eliminated by measurement.
- [x] **Clock-offset hypothesis tested against regime membership — §8, EXECUTED 2026-09-14.**
      Ticked as *tested*, which is what the box asks. 🔴 **The verdict is NOT STABLE — read §8.6 before
      quoting any number from §8.2.** The pre-stated rule returns **SUPPORTED** on
      `uploads/vigil-archive` (ρ 0.644, n 22, p 0.0021) and **INCONCLUSIVE** on the brief's own
      `tepna-smoketest` tree (ρ 0.388, n 25, p 0.0584) — and those are not two samples, they share 20
      of 25 nights. `2026-07-24` alone carries the disagreement: the third-largest offset excursion in
      the corpus sitting at the *lowest* PAT SD, which is the counterexample the mechanism forbids.
      §8.3 additionally records that the predictor is entangled with foot-to-foot SD (ρ 0.439), that
      the outcome is at the 450/√12 ceiling on 13 of 22 nights, and that the largest `dPpm` values are
      link artifacts rather than crystal rates. The instrument was already committed
      (`tools/pat-host-offset.mjs`); nothing had to be built.
- [ ] Oracle: does a physiologically-anchored window recover signal above the sensor floor?
      ⚠️ **Do not build the 200–500 ms rail §-park proposes without reading §8.5 first** — the pair is
      chest→ankle and 200–500 is an arm/wrist band, so the constraint would encode an anatomical error
      `PAT-SENSOR-PLACEMENT-CORRECTION` already corrected. §8.5 names a cheaper experiment that settles
      the premise first.
