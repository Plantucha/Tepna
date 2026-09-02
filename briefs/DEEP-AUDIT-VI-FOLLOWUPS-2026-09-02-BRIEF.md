<!--
  DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED — 2026-09-02 (residue of executing all 18 DEEP-AUDIT-VI findings across five sessions in one night; §1 remainders are assigned-by-lane, §2–§3 are sweep/tool candidates awaiting a slot, §4 is the scope line DEEP-AUDIT-VII must open with) · **Created:** 2026-09-02 · **Spawned-from:** `DEEP-AUDIT-VI-2026-09-01-BRIEF.md` (DONE 2026-09-02)

# Executing the sixth audit: what the fixes found that the audit did not have

`DEEP-AUDIT-VI` filed 18 confirmed findings on 2026-09-01. All 18 landed by 2026-09-02 05:00 in **20 PRs**
across four sessions — Magpie F1 #2059 · F2 #2068 · F3 #2064 (+ PpgDex port #2073) · F4 #2072; Osprey
F6 #2055 · F5 #2058 · F15 #2066 · F16 #2070; Kestrel F7 #2056 · F9 #2060 · F10 #2061 · F14 #2062 · F12 #2063
· F11 #2065 · F8 #2067 · F13 #2069 (spine, landed last); Heron F17+F18 #2057 (+ #2071 teardown). The audit
stamps went into the parent brief in the same sessions (TRIAGE STAMPS THE BRIEF). This brief records what
executing them turned up that the audit could not see — the pattern of DEEP-AUDIT-V-FOLLOWUPS, and it is
smaller in defect count and larger in *gate-class* count: five of the items below are ways a green gate said
nothing, found only because someone tried to make a fix land.

---

## 1 · Remainders still open under a finding (lane-assigned, not closed by the fix)

| # | under | what stays open | lane |
|---|---|---|---|
| 1.1 | **F1** | The sibling **`_ACC.txt` clock step** (MotionDex / PMDARRIVAL inheritance) — F1's repro verified the ns step IS present in the ACC file of the same night; the ECG fix bounds the ECG gap walk by the phone-column delta, but the ACC consumer's consequence was **never executed**, and nothing bounds that stream. First step is to run it, not to port the fix. **✅ RAN IT, then fixed it — 2026-09-02 (Magpie).** The consequence, executed on the real 2026-08-27 ACC file: `relSecOf` PREFERS the device counter, so MotionDex published `recording.durSec` **241,589,697 — 7.66 years for a 50-minute recording** — declaring a window ending **2034-04-22**, the window the Integrator's gap-aware overlap tests against. It does NOT crash (1.9 s, plausible-looking summary), which is why nothing caught it. **Census, 1278 ACC files:** 137 files' worst step is a real DROPOUT (device delta ≈ phone delta — the counter is right about those, left untouched) and exactly **3 are resyncs** — the same three nights F1 found on the ECG side; 0 seams unparseable. Fixed with F1's discriminator, deliberately identical. The new segment anchors on the seam row's **host offset** rather than by subtracting the step, per §7's ONE DEVICE CLOCK PER AXIS (#2075): the pre-seam residual walks 1.449 s over 10.6 s (136,064 ppm — the ACC sibling of F1's +1508 ms/9.5 s on the same night's ECG), so subtracting alone would carry that error across all 148,860 rows instead of the 469 pre-seam ones. After: durSec 3,019 s; post-seam drift **−18/−21/−16 ppm** across the three nights (one consistent H10 crystal, median-of-decile — an endpoint-only read gives 2081 ppm because the last row is a BLE batch-jitter outlier). 16 assertions incl. a real-dropout control, a clean-stream byte-stability leg, and a blind-seam leg that **caught a bug in my own first fix** (the unparseable-stamp fallback re-admitted the step). | Magpie (JS) |
| 1.2 | **F1** | **Capture-side hardening**: rotate the file set on a `clock_watchdog` step so a resynced night lands as two fragments instead of one poisoned file. **SPECIFIED 2026-09-02 (Heron) — see §1.2a below; NOT built:** it is a capture-daemon change and waits on owner authorization, not on a free slot. | Heron |
| 1.3 | **F1** | **ONE DEVICE CLOCK PER AXIS** — the refold, not the audit, found that pre-resync anchors carry a *different oscillator state* (08-27: +1508 ms over 9.5 s ≈ 160,000 ppm) and `hostAxis` quoted it into `fs`. Fixed for ECGDex (`anchorsDroppedPreResync`, `clockResyncs[].hostOffsetMs`); **the principle is not yet stated in the Clock Contract §7** — an axis must be built from anchors of ONE clock state, and a resync boundary is a state change. Add the paragraph; then check PpgDex's `hostAxis` call site for the same pre-resync exposure. **§7 paragraph BUILT 2026-09-02 (Kestrel)** — the contract now names the split, the ECGDex fields, and the rule that a node which detects no steps has not shown it has none. **PpgDex check OPEN**: `ppgdex-dsp.js` has NO step detection at all (`grep -i resync` → 0), so the question is first whether `_PPG.txt` ever carries a counter step on a resynced night, then the split. **✅ CHECKED — the split is NOT owed, measured 2026-09-02 (Magpie).** Answering §7's own rule that *a node which detects no steps has not shown it has none*: **0 of 3674 corpus `_PPG.txt` files carry a resync** (84 real dropouts, 402 without an ns column). The resync is H10 FIRMWARE behaviour — the 2019-01-01 epoch adopting real time — and the PPG stream is the Verity's, so there is no night the fix would change. **The exposure is real but unreached, and the existing guard is narrower than it looks:** planted with the true step magnitude, `hostAxis` REFUSES (±50,000 ppm) so `fs` is never corrected by a fabricated rate — that guard works — but the refusal protects the RATE and **not the AXIS**: `relSec` still spans 2.416e8 s, and every duration, epoch grid and export window downstream is built from it. The same distinction §7 draws between quoting `.ppm` and consuming `correctionAt()`, one level up: **a refusal on one quantity is not protection of another.** Recorded as a 6-assertion TRIPWIRE group rather than a prose caveat — if a firmware change or a new capture path ever produces a stepped `_PPG.txt`, the exposure leg starts failing and the split becomes owed. | Kestrel (CLAUDE.md §7 — DONE) → Magpie (PpgDex check — DONE) |
| 1.4 | **F2** | Both lanes now resolve `t0Ms` by Clock Contract §4 "first VALID sample". **If a real night ever shows the old app rule ("first non-empty, null if unparseable") choosing a different row, quote the row here** — do not regenerate on the assumption. **Not checked by any sweep**: F2's six-file parser-parity run (2 committed twins + the equiv clip + the three resync nights) asserts that the two PARSERS agree, not that the two ANCHOR RULES pick the same row, and the old rule no longer exists in either lane to run. A watch item with no supporting measurement behind it. | any, on sighting |
| 1.5 | **F4** | ~~`edrResp`'s own `emerging` grade was NOT adjudicated~~ — **ADJUDICATED 2026-09-02 (Osprey): re-tiered emerging → `experimental`.** The brief's premise that *"it needs a reference the corpus lacks"* was **stale**: 33 nights carry both a raw `_ECG.txt` and a CPAP `*BRP.edf`, and **24 pass a pre-registered overlap rule** (≥4 h AND ≥60 % of the shorter recording); 24 paired, 2 excluded as fallback-15, **n = 22**. Bands frozen before the run. Reference: the device's own mask-on **`RespRate.2s`** — *not* `detectBreaths().breathRate`, which was **rejected on a pre-registered structural criterion** (it divides breaths by WALL duration while every sibling ventilation metric in that block is `_filterBy(..., maskOn)`, so it is diluted by mask-off time — see 1.9). Result: **MAE 1.90** br/min (bar ≤1.5) · bias −1.01 · **LoA [−5.80, +3.78], width 9.58** (bar ≤6) — both fail. ⚠️ **`r` is not cited**: the reference's between-night SD is 0.54 br/min (range 14.8–16.8), so a correlation is range-restricted by construction. 🔴 **The decisive control:** a CONSTANT **15.0** br/min — the metric's own hardcoded fallback — scores **MAE 0.80** on the same nights, and a constant 15.8 scores 0.42. The estimator is beaten by the constant it falls back to, carries ~5× the reference's spread (2.50 vs 0.54) and misses to 7.4 and 20.0 against a truth that never leaves 14.8–16.8. **Not adjudicated by this and still `emerging`: the SIBLING `respRate` (registry line 54)** — a different estimator (per-epoch median, not whole-record autocorrelation) that the Reference guide's 'Resp Rate' card actually maps to. Do not read this re-tier onto it. | Osprey — **DONE** |
| 1.6 | **F8** | CPAPDex **`therapyHours` = wall duration** feeds the usage KPI and `compliancePct` in the night summary, where mask-on usage is the clinically meant quantity (the F8 fix corrected `usageHours`; `therapyHours` still reads the session span). Measure the gap on the real corpus before deciding whether it is a relabel or a recompute. **MEASURED 2026-09-02 (Kestrel) — gap is ZERO on the whole real corpus; no relabel and no recompute owed.** `tools/cpap-corpus.mjs` over `Ecg nightly/CPAP` (189 nights, 236 sessions, 2026-01-11 → 07-21, all PLD-sourced): `therapyHours` ≡ Σ session `durMin`/60 on 189/189 nights, and `durMin/60 − usageHours` is ≤ 0.0003 h (one sample of rounding) on **236/236 sessions** — max night gap 0.00 h, Σ 1293.8 h both ways, `compliancePct` 98.9 % by either denominator, **zero ≥4 h verdict flips**. Mechanism: a ResMed EDF session record set is opened at mask-on and closed at mask-off (the DSP's own model — "a session is one mask-on file-set"), so the record's wall span IS its mask-on span; the two quantities coincide by the vendor's segmentation, not by luck. The exposure survives only for a writer whose record continues through mask-off time — no such vendor is parsed today. If one is ever added, `buildNight` should prefer Σ `usageHours` over Σ `durMin/60` (the synthetic `prepare→buildSession` route already does, `durMin = usageHours × 60`); do not make that change on this corpus, where it is export-inert by construction and can only move fixtures through 2-vs-3-decimal rounding. | Kestrel — MEASURED, closed |
| 1.7 | **contested** | `capture-host/status_union.py:77` heartbeat-across-DST — **CONFIRMED and FIXED 2026-09-02** (Heron, PR #2077; see §1.7a below for the measurement, including the one correction it forces on the audit's own description). | Heron |
| 1.8 | **F3 / F10** | The PpgDex `cvhrFromNN` port (#2073) changes the **denominator** only. The OxyDex §2.6 group's standing note *"PPGDEX cvhrFromNN IS DELIBERATELY NOT PART OF THIS FIX"* governs **nulling `index: 0`** (the refusal marker two goldens pin byte-for-byte) and is UNCHANGED: 0 still means what it meant. Recorded so a third session does not read the port as a violation of that note, or the note as a bar on the port. | — (record only) |
| 1.9 | **new (from 1.5)** | **`cpapdex-dsp.js detectBreaths().breathRate` divides by WALL duration** (`durSec = recordsRead × recDur`) while every sibling ventilation figure computed beside it (`rrMaskOn`, `tvMaskOn`, `mvMaskOn`, `snMaskOn`, `flMaskOn`) is mask-on filtered. A surfaced breaths/min is therefore **diluted by mask-off time**, per night, by a varying factor — the same shape as 1.6's `therapyHours`. Found by trying to USE it as a reference and rejecting it; **not fixed inside the grading unit** on purpose. Mask-on fraction was 1.000 on all 24 nights measured, so the corpus does not yet show the error's size — that is coverage, not absolution. | unassigned |
| 1.10 | **new (from 1.5)** | ~~`respFromEDR` substitutes a hardcoded `15`~~ — **FIXED 2026-09-02 (Osprey): it REFUSES now.** The value was worse than one unmarked substitution, it was two stacked: no dominant EDR period ⇒ echo the Lomb `respHint`; hint out of range ⇒ the constant **15**. The first is self-contradictory — the method's own comment says the rate is measured *"not echoed from the Lomb hint"*, so its stated independence held only on the nights it succeeded. Now: `respFromEDR = null` plus `respFromEDRReason`, carried into the export and rendered as **"no estimate"** on both app surfaces (the pill used to print `null br/min`). `f0` deliberately keeps its 0.25 Hz analysis centre so `crcPLV`/`couplingStrength` are untouched — nulling it would silently move a different metric inside a unit about the breath rate; whether a PLV computed at an ASSUMED centre is quotable is filed as **§1.11**, not answered here. **Committed twin required and built (§2.1):** no committed input took the branch — the clean twin carries 0.25 Hz baseline wander and its rich golden pins 16.3 — so `synthetic_ecgdex_flat_edr.txt` is the clean twin's morphology with the periodic drivers removed AND beats quantised to exact sample boundaries. Pre-fix code returns **11.1** on it (the hint echo), current code returns null. ⚠️ Two constructions FAILED to reach the branch and are recorded so nobody retries them: broadband noise gave a 19.9 br/min "period" (band-passed noise autocorrelates above the 0.1 floor) and a noiseless un-quantised train gave 7.4 (sub-sample phase jitter modulates the sampled R amplitude). A real clip from 2026-07-02 was staged and then REJECTED: real ECG recordings are not committed here (only synthetic are; the equiv leg's clip is gitignored). 🔴 **And this CORRECTS §1.5's own figures.** §1.5 excluded both nights whose rate was exactly 15.0 as fallbacks, detecting them by `=== 15.0` — the test it flagged as unable to separate a real 15.0 from the constant. Run against the fixed code: **2026-07-02 genuinely refuses; 2026-07-06 MEASURES 15.0.** So n = 22 → **23**, MAE 1.90 → **1.82**, LoA width 9.58 → **9.41**, constant-15 control 0.80 → **0.77**. Both bands still fail and the constant still beats the estimator: the re-tier verdict is unchanged, the registry stamp is corrected in this PR. | Osprey — **DONE** |

---

### 1.7a · The contested DST heartbeat, driven rather than emulated — CONFIRMED, with one correction

The disposition asked for `_now()` to be driven through a real faked-tz transition with a writer open.
Done (`tests/test_status_union_dst_heartbeat.py`): only the clock SOURCE is faked (`datetime.now`,
`monotonic`); the zone is a real tz-database zone, the offsets come from real `astimezone()`, the
naive→epoch conversion is real `datetime.timestamp()`, and `_now()` reaches its absorb branch by its own
arithmetic. The dissent was right that the earlier repro set the anchors; it does not survive driving.

`instance_health` of a heartbeat stamped from `_now()`, recording open across the transition:

| minutes past | spring-forward, healthy | spring-forward, wedged 30 min | fall-back, healthy | fall-back, wedged 30 min |
|---|---|---|---|---|
| 1 | live 0 | stale 1800000 | live 0 | **live 0** |
| 30 | live 0 | stale 1800000 | live 0 | **live 0** |
| 61 | **stale 3600000** | stale 1800000 | live 0 | **live 0** |
| 120 | **stale 3600000** | stale 5400000 | live 0 | **live 0** |
| 300 | **stale 3600000** | stale 5400000 | live 0 | **live 0** |

- **Fall-back is the dangerous leg and is fully confirmed.** A daemon wedged for 30 minutes reads
  `live, age_ms 0` at every age out to 5 h: the heartbeat sits an hour in the FUTURE and `max(0, …)`
  clamps the age. That is exactly the up-but-wedged failure the layer exists to catch, and it is
  invisible for the whole session.
- **Spring-forward is confirmed but the audit's onset is wrong.** It says a live instance reads stale
  "for the rest of the recording". Measured: correct for the first ~60 minutes, stale only from ~61 min
  on. The absorbed stamp is inside the NONEXISTENT hour until then, and Python resolves a gap time
  through the pre-transition offset — which is precisely the frame absorption preserved, so it
  round-trips to the right instant by coincidence. A false alarm all night (`degraded` true for a
  healthy box), starting an hour later than stated.
- **Fix taken: option 1 of the three — stamp the heartbeat from real `time.time()`**, via a named
  `capture.heartbeat_ms()` seam. `updated` keeps the capture frame on purpose; it belongs to the
  recording's timeline. Liveness does not: it is a question about real elapsed time and must be read on
  the clock the reader ages with. Correcting by `absorbed_shift_sec()` reaches the same number through
  two parts that must stay in step; publishing the shift spreads the correction across every consumer.
- **Why the existing clock tests could not have caught this:** the `clock` fixture in
  `test_capture_clock_and_health.py` stubs `capture._utcoffset`, so no real offset conversion happens —
  and the entire defect lives in how a naive stamp in one offset frame converts to an epoch under
  another. The seam exists so the test calls the production stamp instead of mirroring the formula: a
  mirror agrees with the code whichever clock the code reads. Verified by restoring only the old clock
  choice behind the same seam — the three verdict tests fail, the absorb-branch guard still passes.

---

---

### 1.2a · Spec — rotating the file set on a device clock resync (NOT built; owner-authorized box work)

F1 bounded the ECG gap walk so a mid-file resync reads as a re-anchor rather than a 2.41e8-second
dropout, and §1.1/#2080 did the same for the ACC sibling. Both repair the READER. The capture side still
writes one file that fuses two epochs, and this is the spec for not doing that. Written against the code,
not the description; each numbered point is a decision a builder would otherwise have to rediscover.

1. **Trigger on the JUMP verdict `clock_watchdog` already computes, never on "skew != 0".** The function's
   own docstring is the reason: the Verity stamps PMD samples 4 h ahead of the clock we set and no
   re-syncing changes it, so an offset-triggered rotation would rotate every cycle forever. The existing
   `clock_resync_reason` already separates a jump from a constant offset — reuse that verdict, do not
   re-derive it, and rotate only where it says `resynced` after a jump.
2. **It needs cross-task signalling; the watchdog must not close the writers itself.** `clock_watchdog` and
   the device runner are separate tasks and the writers are the runner's locals. The watchdog can only set
   a per-address "rotate requested" flag; the runner acts on it at its next loop turn. That bounds the rows
   written between the sync landing and the seam — state that bound, do not pretend it is zero, and record
   the seam in the night's `CLOCKSYNC.csv` (which already carries the resync verdict) so a reader can
   reconcile the two fragments rather than infer the boundary.
3. **🔴 Reopen BEFORE closing. This is the trap, and it is not obvious.** `_now()`'s fast path re-anchors and
   DISCARDS an absorbed civil shift the moment `open_sample_writers() == 0` (capture.py, the §A1 rule-2
   branch). A rotation that closes the old writers first would momentarily drop the count to zero, and on a
   night that had absorbed a DST relabelling the shift would expire mid-recording — stepping the NEW
   fragment's stamps by the width of the transition, silently, while fixing a different clock problem.
   Order is load-bearing: open the successor, then close the predecessor, so the count never reaches zero.
4. **Rotate every stream of that device, not just the one that carries the step.** F1's own repro found the
   identical ns step in the sibling `_ACC.txt`; rotating `_ECG.txt` alone would leave ACC fused across two
   epochs and reproduce the defect one file over.
5. **Do not rotate the sidecars.** `LinkLogWriter`/`HostClockLogWriter` are deliberately excluded from the
   writer count (writers.py says why: counting them would make the count never reach zero and §A1's expiry
   would never fire). They roll per calendar day and their consumer medians per bucket; leave them.
6. **Acceptance is a real resync, not a synthetic one.** A test must drive `clock_watchdog` to a jump verdict
   with a writer open and assert two fragments whose stamps do not overlap, plus the §A1 property from (3):
   an absorbed shift SURVIVES the rotation. The second assertion is the one that would have caught the
   ordering bug, and it fails on nothing else.

Gate: `capture-host/check.sh`. Deploy: the hourly `tepna-update.timer` like any code change — but the
DECISION to change capture behaviour on a live box is the owner's, which is why this is a spec and not a PR.

## 2 · Gate classes found by trying to land a fix (each a sweep candidate)

### 2.1 A fixture corpus can only falsify what it can express — bitten TWICE in one night
`verify-fixtures` reported "1 stamped / 13 current, no fixture moved" for the PpgDex port, which reads as
"the new export field is inert". It is not inert: **none of the six committed PpgDex fixtures can take the
`cvhrHours` attach branch, by TWO independent mechanisms** (enumerated from `provenance/PpgDex.json`): the three
rich-route goldens (`synthetic_ppgdex_rich_golden` · `_o2ring_finger_golden` · `_inverted_golden`) carry an apnea
block with `cvhrIndex: null`; the other three (`PpgDex_2026-06-27_equiv` — a REAL corpus night, not a synthetic —
`synthetic_ppgdex_golden` · `_gapped_golden`) were produced on the non-rich route, which never emits the block at
all. *(#2073's own commit text and an earlier draft of this line said "every golden is a short synthetic with a null
index" — falsifiable by one glance at the equiv night; corrected on Magpie's enumeration.)* Same for F3: no ECGDex golden is a
long non-ambulatory night, so none carries an `apnea` block at all — and there the wire was genuinely
**dead** (the `analyze()` reshape allowlist dropped `denomSec`; the source-scan assertion passed on a regex
while nothing travelled). A green fixture gate and a passing source scan coexisted with a wire that had
never executed once.

**Rule:** when a new field attaches under a condition NO committed fixture meets, the fixture gate is silent
*by construction* — not reassuring — and the unit owes an **executed end-to-end leg**. Magpie added one on
both nodes; on PpgDex it caught its own first mistake immediately (the apnea block is `opts.rich`-gated, so
the plain builder yields none). Now: 900 s synthetic → `analyze` → builder, asserting
`cvhrIndex × cvhrHours ≈ cvhrEvents`; plus a **cross-node leg** — ECGDex and PpgDex return the SAME index
and the SAME denominator on identical input, the property the Integrator's corroboration rests on and which
nothing had asserted.
**Candidate mechanism:** a *field-attach coverage* check — for every export field attached conditionally
(`if (x != null) out.x = …`), at least one committed fixture or equiv-leg synthetic must take the attach
branch. Same family as the memory `assertions-encode-shape-not-contract`.

### 2.2 Gates that assert SHAPE go red when the code gets BETTER (the inverse failure)
Three existing ECGDex gates reddened on F2 — a change that *strengthened* the invariant each exists to
protect: the stream-fallback group enumerating six accumulator variable NAMES; the worker-clock group slicing
`WORKER_SRC` as one template literal; the `t0Ms` leg regexing an app-side null guard. Re-aimed at the contract
in #2068. **Fourth instance, sharpened:** a gate that asserts a **PLURAL** has encoded the duplication as the
requirement — `Integrator §12-§16` asserted `_fsSites >= 3` and its own comment knew one site was a mirror;
single-sourcing then read as a regression. Re-aimed: DSP keeps the form (≥1, anti-vacuity), app derives NO
rate (exactly 0), ns counter still outranks the mean form.
**Sweep rule:** grep `tests/dex-tests.js` for `>= [2-9]` / `=== [2-9]` on a count of source sites,
accumulator names, or copies, and for any assertion that greps a variable name or slices source text. Each
is a candidate; the fix is to assert the property the copies were evidence *for*.

### 2.3 "Structurally pinned because we cannot execute it" is a DATED claim
The fallback group's note said the harness has no async group so the invariant is pinned structurally. The
moment the scan became a DSP export (F2), DEEP-AUDIT-II §4.4's stale re-read became executable with a defect
direction. Such comments should carry a **date and the condition** that makes them true, and be re-checked
whenever the module boundary they lean on moves.

### 2.4 Two `dormant:true` registry flags were false WHEN WRITTEN
#1455 (2026-08-18) flagged `rraccRate` and `edrDisagree` dormant with a comment claiming a per-name sweep of
every surface; both had compute + surface sites since the initial commit (`accExtras`/`_accCardRR`;
`ecgdex-app.js disagreementRatePct`). Examined-nothing family: a sweep that examined other surfaces than
it claimed. **Sweep:** every `dormant:true` in every `<node>-registry.js`, checked against a grep of the id
AND its aliases in the app/render files.

### 2.5 An UNREGISTERED surfaced label is an UNCHECKED grade
The ECGDex Reference guide graded posture `ev-measured` for a mount-dependent convention — invisible because
'Posture' resolved to no registry id, so `cohesion-badges` had nothing to compare. Registering the id made
the wrong grade visible and it was corrected to experimental. **Sweep:** every reference-guide card label with
no `idForLabel` hit is a grade nobody checks.

**SWEPT 2026-09-02 (Kestrel) — 127 of 414 graded cards were unchecked; the gate is now resolve-or-declare.**
Measured over the 8 reference guides (414 graded cards): **OxyDex 96 · ECGDex 23 · PpgDex 5 · CPAPDex 3**, the
other four 0. Each card was crosswalked by hand against its registry + DSP and declared in the guide markup —
this is a doc + test unit, no bundle moves. Two attributes, on the card's opening `<div class="mc"`:
`data-id="<registry ids>"` for a metric whose label the resolver cannot map (space-separated for a compound
card), and `data-kind="citation|pipeline|unregistered"` for the three non-metric shapes. `cohesion-badges` (b)
now asserts, per guide: every graded card resolves (label · '/'-split parts · declared id) **or** declares a
kind; a declared id that is not a registry key is a red (a typo must not un-gate a card); and the
`unregistered` set **equals a list declared in the test** — a new one reds (register it instead), and a
declaration the registry has since learned reds (the list may only shrink). Three planted controls per
guide: an undeclared unregistered card is counted, a bad `data-id` is a red, a stale `unregistered` is a red.

- **Grade disagreements the resolver had been hiding — 25, all corrected to the registry (registry wins):**
  OxyDex **23** — 19 cards badged `heuristic` where the registry says experimental / emerging / measured
  (SD1 / SD2, SDNN proxy, CHA-94, OxyCrash, T-AUC Weighted, SSI, Sleep Stability, WASO Windows, Positional
  Shifts, Recovery Index, Coupling Score, PB HR Contrast, PB Diverge, PB Episode Trend, Poor Nights % →
  experimental; DFA α1, AHI Estimate, Respiratory Rate (proxy), Nocturnal HR Dip → emerging; Cond. Mean/% <94,
  Nadir Depth Bins → measured) and **two OVER-claims** — `SpO₂ Night CV` badged measured, registry
  experimental; `ODI-4 First→Last Δ` badged validated, registry experimental. ECGDex **2** — Lomb–Scargle
  Spectrum emerging → **validated** (its five constituents `vlf lf hf lfnu hfnu` are all validated, Task Force
  1996); Fragmentation experimental → **emerging** (`pip`). PpgDex / CPAPDex 0.
- **Registration debt — 38 surfaced metrics no registry grades** (declared `unregistered`, counted by the
  gate; a JS-surface unit, **→ Magpie**): OxyDex **35** (MODL · Dip / Recovery Slope · Clustering Index ·
  SpO₂ SampEn · SpO₂ AC lag-1 · IEI · Recovery CV ≡ biCV (same `ieiCV` quantity, two cards) · Desaturation
  Asymmetry · SpO₂ / HR Nadir Timing · SpO₂ Ceiling · O₂-HR Efficiency · Post-Dip HR Response · Worst 10-min
  SpO₂ · Worst 30-min T95 · Stable SpO₂ Windows · RMSSD Arc · LF / HF Power (`hrLfPow/hrHfPow`, NOT
  `rsaPeakPow`) · HR Asymmetry · HR Quartile Trend (NOT `hrSlope`) · HR CV · Circadian HR Amplitude / Nadir
  Hour (NOT `circadianScore`) · Vagal Index · HR Deceleration Runs · SpO₂–HR Decoupling % · SPI · Motion
  Bursts (NOT `restlessWindows`) · Longest Clean Run (NOT `lcsp`) · CS / UARS Score · SpO₂–HR Lag · BLUNTED
  AROUSAL flag · Intra-Night NSI); ECGDex 1 (Data Gaps, `quality.gaps/gapMin`; IALS/PSS are exported at
  `ecgdex-app.js` `fragmentationIALS/PSS` and unregistered too, folded under the Fragmentation card); PpgDex 2
  (Heading `epochs[].headingDeg`, Mag interference `motion.magInterferencePct`). Resolver gaps in the same
  unit: `ECG_LABEL_ALIAS` lacks 'triangular index' and 'accel. capacity'.
- **Four registry entries misdescribe the metric their id renders** (leads, not corrected here — a registry
  edit is a bundle change): `dfaAlpha1` cites pulse-rate DFA but `computeDFA` runs on SpO₂; `ahiEst` says
  "CVHR-derived" but exports ODI-4 × 1.1; `ssiIdx` is labelled "Sleep-stability index" but the SSI chip is
  `n.ssi.ssi` (sympathetic surge); `nadirBinLt4/46/69/Gt9` describe drop-DEPTH bins while the render feeds
  absolute-LEVEL bins (`above91 … below85`). Partial compound registration: ODI-2/ODI-1, T94…T80, kurtosis,
  HD90/HD88 and SD2 have no entry (their cards are gated by the sibling that does).

**OxyDex DISCHARGED 2026-09-02 (Magpie) — and the sweep found the debt was not the defect.**
All 35 OxyDex cards are registered, graded from the CODE by one rule stated in the registry block:
`measured` = a direct readout of sensed values, no tuned threshold and no model · `heuristic` = a tuned
or rule-of-thumb threshold decides the number · `experimental` = a bespoke composite, or an established
method transferred to a signal it was not validated on (the `dfaAlpha1` precedent — name the transfer
rather than inherit the method's standing). Result: 23 grades agree with the guide, **4 the guide
OVERSTATED** and are corrected (`SpO₂ Ceiling` and `Stable SpO₂ Windows` claimed `measured` for threshold
counts; `SpO₂–HR Decoupling %` and `SpO₂–HR Lag` claimed it for a constructed statistic and an estimate —
`measured` means DIRECTLY SENSED), and **8 where the rule would RAISE the badge are left alone**
(MODL, HR Nadir Timing, Circadian HR Amplitude, LF/HF Power, O₂-HR Efficiency, RMSSD Arc, SPI, Vagal
Index). That asymmetry is deliberate: a grade that understates trust is not a false claim, while
upgrading one on a rule its author wrote that afternoon is the fabricated authority the mandate exists to
prevent. Those 8 are listed here so a later pass can decide them deliberately rather than inheriting my
restraint as a verdict.

⚠️ **THE REGISTRATION WAS THE SMALL HALF. Registering a metric puts a registry-backed badge on its
card, so the card's text was verified first — and it does not hold up: 13 of the 35 cards make a
checkable numeric claim, 13 were verified against the code, and 5 were WRONG.**

| card | the card claimed | the code does |
|---|---|---|
| Longest Clean Run | "motion = 0, SpO₂ in 70–100 %, no HR artifact flags" | `spo2[i] > 95` alone — none of the three conditions exist |
| IEI | `IEI_i = nadirTime_i − nadirTime_{i−1}` | `start_i − (start_{i−1} + duration_{i−1})` — the QUIET gap between events, not a nadir-to-nadir cycle |
| SpO₂–HR Lag | `argmax` over `lag ∈ [0..90 s]` | searches `lag <= 120` and reports the MEDIAN of per-window argmaxes |
| Motion Bursts | runs "separated by ≥30 s of quiet" | a run ends at the first quiet sample; counted if `burstLen >= 3` |
| SpO₂ Ceiling | "exactly 100 % for ≥30 consecutive" | `spo2 >= 99`, `run >= 5` |

All five corrected DOC→CODE (the code shipped, is fixture-backed, and produced every number a user has
seen). Eight were correct as written — including the two most intricate, CS Score and UARS Score, whose
four-criterion `.ft` lists match the code exactly — so this is specific drift, not uniform decay. The four
registry-side leads are corrected in the same pass with their code lines: `dfaAlpha1` (cite said PULSE
rate; `computeDFA` maps `r.spo2`), `ahiEst` (label AND cite said CVHR; the value is `odi4Rate × 1.1`),
`ssiIdx` (cite said sleep-stability; `computeSympSurge` and the DSP's own row say 'Symp Surge'), and the
`nadirBin*` family (labels and cites said DEPTH; oxydex-dsp.js:4524 bins on absolute LEVEL — a
half-finished fix, since the code comment records being corrected to level while the labels never
followed). The nadir labels are corrected at the render and CSV sites too, with both spellings aliased so
no surface loses its badge; registry **ids are unchanged**, so no export identity moves.

#### 8 tiers held below the code rule — RULED 2026-09-02 (Kestrel), all 8 raised
Each row's grade would RISE under the rule stated in the registry block, and none was taken in #2083:
understating trust is never fabricated authority, and raising a badge on a rule written the same
afternoon is what the mandate forbids. **All 8 were ruled on 2026-09-02 by Kestrel and RAISED — each on
a ground independent of that rule**, namely §🎫's own retired-vocabulary mapping (composite→experimental),
the `dfaAlpha1` transfer precedent, or an existing registry precedent for the same shape. Executed as a
follow-on OxyDex PR: registry and guide cards in lockstep, ids unchanged, each ground recorded in the
entry's own cite so the reasoning travels with the grade rather than living only here.

| card | tier | ruling | ground (NOT the author's rule) |
|---|---|---|---|
| MODL | heuristic → measured | **RULED: raised** — registry precedent `nadirDepth` ("mean depth of those nadirs, in the sensed unit", measured): a mean of sensed values over a threshold-defined set, where the threshold belongs to the DETECTION metric (odi3), not to the mean |
| HR Nadir Timing | heuristic → measured | **RULED: raised** — registry precedent `minSpo2` ("lowest recorded — direct reading"); the 5-min smoothing window stays named in the cite |
| Circadian HR Amplitude / Nadir Hour | heuristic → experimental | **RULED: raised** — a fitted model is not a threshold, and cosinor on oximeter pulse rate is the dfaAlpha1 transfer class |
| LF / HF Power | heuristic → experimental | **RULED: raised** — the dfaAlpha1 precedent verbatim: Task-Force bands transferred to oximeter pulse rate, with the transfer named in the cite |
| O₂-HR Efficiency | heuristic → experimental | **RULED: raised** — §🎫 retired-vocabulary mapping composite→experimental |
| RMSSD Arc | heuristic → experimental | **RULED: raised** — §🎫 composite→experimental |
| Sleep Pressure Index (SPI) | heuristic → experimental | **RULED: raised** — §🎫 composite→experimental |
| Vagal Index | heuristic → experimental | **RULED: raised** — §🎫 composite→experimental |

*(Vagal Index's card was examined and left alone on a separate point: its `.md` opens "Weighted
composite", which is loose for a product with a log term — but its `.ft` states the exact formula and the
`.md` goes on to name the multiplicative form. The checkable claim is correct, so it is not counted among
the 5 corrections. Recorded because the looser phrase is the kind of thing a future sweep will re-flag.)*

### 2.5b LEAD — nothing compares a card's DESCRIPTION against the code it describes
`cohesion-badges` gates the tier, `registry-defs-parity` the crossnight projection, `citation-ledger` the
DOI attribution. The sentence that tells a user what a number MEANS is ungated across all eight guides.
Hand rate on the one node swept: **5 of 13 checkable numeric claims wrong**, plus 4 registry-side
descriptions, none of which any gate could see. Candidate mechanism: a checkable-claim extractor —
thresholds, windows and units stated in a card's `.ft`/`.md` versus the constants in the node's DSP — which
would have caught all five. ⚠️ **It would also have a blind spot worth designing around from the start:**
the 5 were found by keying on NUMERALS, and a claim can be structural without one — "weighted composite",
"median", "consecutive", "uninterrupted". Vagal Index was checked by hand for exactly that reason and came
back clean; `Longest Clean Run`'s defect was structural too ("motion = 0 … no artifact flags") and only
surfaced because the word "clean" invited a look. A numeral-keyed extractor finds the cheap half. Not built here. The other 7 nodes are unswept.

### 2.5c `goodDirection` vs the code that decides good/bad — SWEPT and GATED 2026-09-02 (Magpie)
A registry `goodDirection` inverts the READING of a number, and nothing compared it to anything. Two
inversions were found by hand in OxyDex (#2083: `ssiIdx` `'up'` while the DSP scores `<0.3` as severity 0;
`nadirBinLt4` `'up'` while the render treats fewer as better) — **both while doing something else, neither
by a sweep**, which is what argued for a standing check rather than a one-off table.

**The filter, stated with its counts.** Across the 7 previously unswept nodes: **352 registry entries carry
a `goodDirection` and 0 do not** — there is no "lacking direction" class to list. Per node: ecgdex 78 ·
pulsedex 69 · ppgdex 66 · cpapdex 53 · glucodex 42 · hrvdex 34 · motiondex 10.

**Result: 25 distinct metrics are DECIDABLE, and all 25 agree — 0 inversions outside OxyDex.**

**What "decidable" means, and why the rest is not.** A decision is attributable only when the comparison,
its verdict token and the metric's identity sit in ONE expression — two source classes: a render/app
colour ternary on a line carrying `evBadge('<label>')`, and the DSP findings row `push('<id>', '<Label>',
<value>, <value> <op> <n> ? <severity> : …)` (severity ASCENDS with badness, so a first band of 0 means the
low end is good). Everything else is **undecidable-by-instrument**, recorded by reason class rather than by
row:
- **`push(...)` severity rows are an OXYDEX-ONLY idiom.** Verified by reading every `push('` site in the
  other 7 — they are flag lists and text fragments, not severity rows. The 0 is a property of those nodes,
  not of the regex.
- **The other nodes DO decide severity in the DSP** — `sev = 'good' | 'warn' | 'bad'` — but inside
  multi-line `if/else` blocks, where the metric's identity is not in the same expression as the verdict.
  Attributing those needs an id→DSP-field map that does not exist.
- **MotionDex is decidable by ABSENCE, and is its own class: "no code decides".** No value-based good/bad
  exists anywhere in `motiondex-render.js`/`-app.js` — no `'ok'/'warn'/'bad'` ternary, no severity
  ordering. Its 10 declared directions are **unverifiable, not wrong**: nothing consumes or contradicts
  them.

**Gated, not tabled.** `registry · direction · cross-node` asserts agreement over the decidable set on
every run. It deliberately does **NOT** ratchet the coverage count — a render reflow would red a plural for
a non-defect (§2.2's class). Coverage is proven instead by **planted controls, one per source class**: an
inverted render ternary and an inverted severity row must both be caught, and the agreeing shape must NOT
be flagged, so a change that blinds the extractor fails loudly instead of passing over nothing.

**Extractor caveats, both found by getting them wrong first** (recorded the way §2.4's note is, because the
next person will reach for the same two shortcuts):
- **NEIGHBOUR ATTRIBUTION.** Searching NEAR a metric's name rather than within one expression scores the
  next row's decision. Measured: PpgDex `cleanPulses` was scored by the `motionRejectedPct` line two rows
  below and reported as inverted. A ±4-line window is not a safe join in a stat grid.
- **THE SECOND BAND.** `v >= 90 ? 'ok' : v >= 75 ? 'warn' : 'bad'` matches twice, and scoring the middle
  band inverts the answer — it produced **11 false inversions, every one a second band**. Only the FIRST
  band decides.
Both caveats are pinned by their own legs, so a "simplification" that re-introduces either fails. A third
was caught in review of this gate itself: the caveat leg originally keyed on a metric absent from the probe
registry, so it silently never ran — **a conditional control that cannot fire is not a control**, which is
§2.1's shape one level up.

### 2.5d Write the §2.6 case as a TEST, not a comment — it caught a bug in the fix itself
FOLLOWUPS §1.1's MotionDex fix (#2080) re-anchors a stepped device counter. The §2.6 branch — an
over-24 h step whose seam stamps do NOT parse — was handled in code and described in a comment. Written
as a test leg instead, it immediately failed: the unparseable-stamp fallback re-anchored to the STEPPED
counter and published a 241,586,834 s span, while every other leg in the group was green. The §2.6
branches ("a duration nothing measured stays unmeasured") are exactly the ones a happy-path fixture never
enters, so a comment describing one is a claim nothing checks. **Rule: when a fix has a
refuse/unmeasured branch, that branch owes a test leg, not a sentence.** Same family as 2.1.

### 2.6 The dormant-surface alias matcher: an alias shorter than a word is not a surface token
MotionDex `uprightFrac`'s bare alias `upright` matched a posture ENUM value in `POS_ORDER` — a false
positive. Matcher (#2072) now admits the label always, an alias only if multi-word or ≥ 8 chars; negative
control keeps the ECGDex pair. Generalise to any label-driven scan.

### 2.7 A `rec.gaps` fold ADDS dead time to later beats rather than removing them
A folded night keeps its active seconds and grows only its span (F3). Read this before writing another
gap-geometry test — the intuitive "gaps subtract" model produces assertions that pass for the wrong reason.

---

### 2.8 A fixture that STUBS the thing under test makes its whole file structurally blind

`test_capture_clock_and_health.py`'s `clock` fixture patches `capture._utcoffset` with a fixed
`timedelta`. That is what makes the transition tests cheap and deterministic — and it also means no real
offset conversion ever happens in that file. §1.7's defect lives ENTIRELY in how a naive stamp in one
offset frame converts to an epoch under another, so the file that exists to test DST could not have
caught it at any effort level. It is not a missing test; it is a test surface that cannot express the
failure, which is §2.1's shape one layer up: there the corpus could not express it, here the fixture
cannot.

The tell is cheap to check and worth making a habit: **name the function whose behaviour the test is
asserting, then confirm the fixture does not replace it.** A stub of the thing under test reads exactly
like a stub of its environment.

The fix is not to un-stub that fixture — its determinism is worth having — but to add a sibling that
fakes only the clock SOURCE and lets the real zone, real `astimezone()` and real `timestamp()` run
(`tests/test_status_union_dst_heartbeat.py`, #2077). Two fixtures, two questions.

## 3 · Tooling and process residue

**Endpoint-to-endpoint drift lied by 100× against a median-of-decile (2026-09-02, #2080).** Checking
whether the MotionDex re-anchor worked, the natural measure — host−device residual at the first row vs the
last — read **2081 ppm** on 2026-08-27 and suggested the fix had not held. The jitter-robust
median-of-first/last-decile reads **−18 ppm**, an ordinary H10 crystal, and the three nights agree
(−18/−21/−16). The endpoint figure was one BLE batch-delivery outlier at the final row, which is also the
whole of an apparent 7.6 s span discrepancy. Clock Contract §7 already warns that two points cannot
separate a step from a rate for `hostAxis`; the same trap sits one layer out, in the check you write to
prove your own fix worked, and first-vs-last is the natural way to write it. Prefer a median of deciles
whenever a residual is compared across a recording.

### 3.1 `rebase-safe` "THIS REBASE DISCHARGED N VERIFICATION(S)" over-reports by design
Seen on F11, F12, F13 (Kestrel) and F2 (Magpie): it reports every stamp that reverted to the base's, not
whether the revert *mattered*. **Verdict rule used all night:** `git diff origin/main -- provenance/<Node>.json`
EMPTY **and** the branch touches nothing in that node's compute closure ⇒ main's verification is valid and
verify-fixtures' "already current" is correct, not a skip. Otherwise run `verify-fixtures`. **Tool fix:** print
the two sub-cases separately — *stamp reverted AND differs from base* (a real discharge) vs *stamp equals base*
(nothing owed). Cost of not fixing: a full ~11 min verify lap per false alarm.

**PRE-PUSH INSTRUMENT (2026-09-02, Magpie).** The verdict rule above reasons from a diff; this MEASURES the
thing itself, in three lines and no suite run — a stamp is valid iff it equals the bundle's CURRENT compute
identity:

```js
const MG = require('./manifest-gate.js');
const ch = await MG.computeHashFromText(fs.readFileSync('OxyDex.html', 'utf8'));
// every corpus-backed fixture of that bundle must have verifiedUnder === ch
```

Run before any push that rebased over `provenance/**`. It answers in milliseconds what `verify-fixtures`
answers after ~11 minutes, and unlike the diff rule it cannot be fooled by a peer's stamp arriving through a
rebase (the hazard that bit Osprey) — because it compares against the code, not against `origin/main`.
**LEAD: `rebase-safe` should run this automatically after resolving anything under `provenance/**`** and say
per fixture whether the stamp is still current, which would make §3.1's over-report self-answering rather
than merely better-worded.

### 3.2 A spine PR costs one full verify lap per merge ahead of it
F13 (`dex-export.js`, 11 bundles) had to re-verify after each node PR merged under it (vf3 → vf4). The
"land the spine last" order was right; the missing rule is **hold the other lanes' pushes from the moment the
spine's verify starts until it is pushed** — otherwise each merge burns another lap.

### 3.3 Pre-rebase a HELD branch while its conflicts are only with your own merged work (Osprey, F16)
Rebase-safe onto main at idle time when the conflict set is self-owned; the eventual landing is then a
near fast-forward. One rebase-safe + build, no CI. Adopt as a fleet habit.

### 3.4 `selftest-all` could not REPORT a non-assertion failure — cause NAMED 2026-09-02 by the instrument
**This section previously named a mechanism that is now falsified, on my say-so (Magpie). Recorded as a
correction rather than overwritten, because the error is the brief's own subject.**

*Was:* "`doc-search.mjs`'s selftest runs immediately before `dsp-review-qwen.mjs`'s and both share the
local bge-m3 chunk index" — proposed fix, serialise them behind a lock. That was inferred from
ADJACENCY (the two run next to each other; standalone runs showed "0 newly embedded" where the
chain-time run was re-embedding), never from the call path.

**RULED OUT by reading the code:** `docContext()` — the only doc-search caller in that tool — is wrapped
in try/catch returning `''` with a 30 s timeout, so it **fails soft by construction** and cannot fail a
run; the selftest never calls it (all 21 assertions are pure: chunker, `parseFindings`, `fnKey`,
`buildPrompt`, the lens table); and `pipelineBusy`, which looked like process-table inspection, takes the
`ps` output as an ARGUMENT and is handed literal strings. **There is no index in that selftest's path at
all, so a lock would have protected nothing.**

**Cause: still UNKNOWN.** What is established: the failure is NOT an assertion failure. Both occurrences
printed `✗ tools/dsp-review-qwen.mjs FAILED` followed by a BLANK line, and the tool passes standalone
(21 ok, 0 failed). Live hypothesis, unconfirmed: a load-dependent timeout or crash — `selftest-all` runs
all 81 tools at once (`Promise.all(files.map(run))`) with a 120 s per-tool timeout, and both failures
happened inside `npm run check`, where six suite shards run alongside. Against that: a third run under
the same full-check load PASSED, so load alone does not explain it. **Do not tune the 120 s timeout as a
first move** — that would be treating a symptom whose cause is unnamed.

**What actually shipped is the INSTRUMENT, not the fix.** The runner filtered a failing tool's output to
lines containing `✗` or `FAILED` — the signature of an ASSERTION failure — and discarded `err` entirely,
so a timeout or crash printed a bare "FAILED" and a blank line. The evidence was being thrown away at the
moment of failure, which is why two reproductions produced zero diagnostic information. Now: the exit
status is named (`TIMED OUT after 120s (killed, SIGTERM)` · `exited N` · `killed by SIGKILL`), assertion
lines still lead when present, otherwise the TAIL of whatever the tool did say, and `(no output at all —
consistent with a timeout or a kill before the tool printed)` when it said nothing, which is itself the
tell. Verified against a PLANTED hanging tool, which now reports exactly that. 10 assertions pin the
classifier, including that `killed` outranks `code` (a killed process carries both).

**CAUSE NAMED — on the instrument's FIRST run after it shipped (#2089).** The third occurrence, during
the §2.5c chain, reported itself instead of a blank line:
`✗ tools/dsp-review-qwen.mjs FAILED — TIMED OUT after 120s (killed, SIGTERM)` /
`(no output at all — consistent with a timeout or a kill before the tool printed)`. The class is settled:
a **timeout**, never an assertion failure — which is precisely what two prior occurrences could not say.

**And WHY, because "it timed out" is a symptom too.** The tool's selftest is pure (21 assertions over the
chunker, parser and prompt builder), its module imports in 0.10 s with no blocking top-level work, and it
passes standalone. Timing every selftest in the sweep:

| tool | wall |
|---|---|
| `mutation-crawl` | 4.10 s |
| **`dsp-review-qwen`** | **3.60 s (100 % CPU)** |
| `nsrr-stage-validate` | 1.20 s |
| the other 78 | ≤ 0.30 s |

Two tools are 12–40× the rest, and `selftest-all` launches **all 81 via `Promise.all` with no pool** —
so the tool with the highest CPU demand is the one a contention spike reaches first, which is why it is
always this tool and never a 0.2 s one.

⚠️ **BUT THE SOURCE OF THE CONTENTION WAS ASSERTED AND IS WRONG — corrected here rather than quietly.**
An earlier version of this paragraph said the sweep runs "while the suite holds 8 shards", giving ~89
runnable processes. **`npm run check` is a sequential `&&` chain and `test:tools` runs BEFORE
`test:par`** — the shards are never running during the sweep. Measured after that claim was written: a
controlled reproduction (suite deliberately started first, then the unpooled sweep with the timeout
lifted so the value is uncensored rather than a 120 s kill) put `dsp-review-qwen` at **6.3 s**, a
contention factor of only ~1.75× over its 3.6 s standalone — nowhere near 120 s. **So neither the sweep's
own concurrency nor the shards explains the kills.** What remains, and is consistent with every
observation, is CROSS-SESSION load: several fleet sessions run full gates on this box at once, which is
invisible from inside any one of them. That is a hypothesis with a mechanism, not a measurement — it is
not claimed as established.

**The prediction stands and is now sharper:** `mutation-crawl` (4.1 s) should be the next to time out,
and a ≤0.3 s tool timing out still refutes the CPU-demand account. Added: if a kill ever happens while
the box is otherwise idle, cross-session load is refuted too.

**FALSIFIABLE PREDICTION, recorded so the account can be wrong out loud:** if this is right,
`mutation-crawl` (4.10 s) is the second-most likely to time out and should eventually appear; **if a
≤0.30 s tool ever times out, the CPU-demand account is refuted** and something else is at work.

**The timeout is NOT the defect and is not tuned.** The defect is unbounded concurrency over 81 child
processes; a pool fixes the class rather than this tool. Left for its own unit.

**§4b's family:** 
a report that shows the part matching its expectations and silently drops the rest.

### 3.6 A `<node>-registry.js` edit is a COMPUTE-PATH change, and a re-tier owes a verify lap
Editing a registry feels like documentation — it changes a label, a cite, a tier. It is not: every
`<node>-registry.js` is inlined into its node's bundle and sits inside that node's **compute closure**
(`manifest-gate.js`'s closure is a DENYLIST, so an unlisted asset is inside it by construction). A
re-tier therefore moves `computeHash`, and every corpus-backed fixture of that node owes a
re-verification.

**Measured 2026-09-02:** #2078 re-tiered `edrResp` in `ecgdex-registry.js`, rebuilt, and re-stamped
`manifestHash` — but `ECGDex_2026-06-27_equiv`'s `verifiedUnder` stayed at `302dead99e51`, the value
produced by #2080 BEFORE that edit. `origin/main` therefore carried a corpus-backed ECGDex fixture
verified under pre-#2078 code: the state `tools/release.mjs` refuses to cut a release over, and the one
CI reports without blocking. Discharged by the §2.5 OxyDex PR, whose `verify-fixtures` run re-earned it
honestly (302dead99e51 → 65e8a013d842) and which names whose stamp it is rather than absorbing it —
the `verify-fixtures-discharges-others-debt` shape.

**Nothing malfunctioned — and that is exactly why it is dangerous.** `build.mjs` re-stamped the hash it
can compute and is FORBIDDEN to write `verifiedUnder`, because that one requires actually running the app
(§🔏 — auto-writing it is how a stale fixture shipped once already). So after a registry edit the fixture
**LOOKS verified**: GATE A and GATE B are static, they re-reconcile against the freshly-written
`manifestHash`, and both go green over a compute path that has moved underneath them. A static green
across a moved compute path is SILENCE, not evidence — the one signal that would have spoken,
`verifiedUnder`, is precisely the one no builder is allowed to forge. The gap was the author's model of the file, not the tooling: "docs-only"
is a property of a diff's INTENT, never of a file's position in the closure. **Rule of thumb: if the
file is inlined into a bundle, the PR owes `verify-fixtures`, whatever the change reads like.**

### 3.7 A guard whose ESCAPE HATCH does not work, and which fires on the read it recommends

Both halves measured 2026-09-02 while rebasing #2086 onto #2083, and both are fixed in the same PR.

- **The documented hatch was unreachable from a Bash call.** `guard-stale-brief.sh` tested
  `CLAUDE_ALLOW_STALE_BRIEF=1` in its OWN environment, and a PreToolUse hook is a separate process
  that runs BEFORE the command it gates — so `CLAUDE_ALLOW_STALE_BRIEF=1 git rebase …` never reached
  it. The hook's denial text and CLAUDE.md §📌 both presented that form as working. A session that
  had done exactly what the guard asks — read the upstream commits, then rebase — was denied twice
  with no way to distinguish the hatch from a broken guard. It now honours a command-position prefix,
  and the denial text names `export` as the only form an `Edit`/`Write` can use, because that path
  carries no command text at all.
- **It fired on a READ, and specifically on the read its own remedy implies.**
  `grep -n '<<<<<<<\|=======\|>>>>>>>' briefs/X.md` — how you find conflict hunks mid-rebase —
  matched the write heuristic, because a run of `>` next to a guarded path looks like a redirect. A
  run of ≥3 `>` is a conflict marker; shell redirection has only `>` and `>>`, so the heuristic now
  strips longer runs before testing, and a real `>>` append is still caught (paired leg).

The shape worth carrying: **a guard is not finished when it denies the right things — its ESCAPE and
its ADVICE are part of the surface.** This one told the operator to run a command it would deny, and
offered a hatch it could not read. Neither is visible from the deny-path tests, which is why both
legs are anti-vacuity legs: each was run against the unfixed hook first and had to FAIL there. One
draft leg passed against the unfixed hook (its `cd /tmp` resolved a non-repo, so the guard failed
open and proved nothing) — that is the §2.1 shape again, in a test I had just written.

### 3.5 Kill only what you own; a pattern is not a name (Osprey / Kestrel, 2026-08-31 → 09-01)
A pattern kill hit a PEER's gate unit; a clearing sweep globbed `*check*.log` while the evidence sat in
`*vf*.log`; a superseded monitor kept firing with authoritative-sounding text. Standing rules, now in memory
(`kill-only-owned-pids`, `kill-by-pattern-hits-peers`, `superseded-monitor-still-fires`): stop only named
`systemd --user` units; after any reported kill re-check every sentinel log for a missing `EXIT=`; `TaskStop`
a retired monitor in the same turn you retire it.

---

## 4 · The standing empty cells — DEEP-AUDIT-VII opens HERE, not with a new charter pass

Two cells the audit named as unexamined are **still unexamined after all 18 fixes landed**, because no fix
touched them:

1. **The browser lane was not booted.** `Dex-Test-Suite.html?full`, `verify-provenance.html` and the
   render-coverage rigs were never run this pass. F2's app-lane work exercised `WORKER_SRC` by source
   extraction in a vm. Every green above is a headless green.
2. **Integrator noisy-OR posterior · `effConf` · Poisson-null / event-coupling surrogate** — **three
   consecutive audits** unexamined. F11 fixed the grouping that feeds it; the arithmetic downstream has never
   had an executed lens. This is the largest unverified surface in the suite and it must be the FIRST finder
   in the next workflow, not the tenth.

---

## 5 · Leads not assigned (cheap first probes)

- **A post-auth decode failure should be named by CAUSE, not left to read as a link stall** (Heron, from the
  O2Ring AES work-unit). Newer O2Ring-S firmware keys an AES/ECB session after AUTH; our BLE handshake writes
  AUTH `response=False` and reads no reply, so on such a ring the `0x10` ack and `0x04` frames fail the
  `[0xA5][cmd][~cmd]` header check or CRC-8 and the ring **connects, auths "successfully", and delivers no
  decoded frames** — indistinguishable from a bad link, and already reported as a stall by the path that
  exists. The misattribution cost is the whole point: an operator would chase a radio problem that is not
  there. #2084 arms the observable half (the ring's DIS firmware revision reaches `STATUS`, and an
  unmeasured version is named at connect). The remaining half is the decoder saying so by name — after N
  consecutive header/CRC rejections on a link that authed cleanly, report "frames failed header/CRC after
  auth — firmware may key the session" rather than a stall. Cheap first probe: count those rejections
  separately from the stall counter and see whether the two are already distinguishable in today's data.

- ~~**15 of 48 box nights have NO ECG/PPG beat-train overlap** — a capture-session fact, not a DSP one~~
  🔴 **REFUTED AND FIXED 2026-09-02. The lead was mine and it was wrong: it was my own tool.** Heron's probe
  inverted it (46 of 48 nights carry both streams and every one of the 15 has hours of real wall-clock
  overlap), and the cause was `pat-window-oracle.mjs pick()` selecting the LARGEST `_ECG.txt` and the LARGEST
  Verity `_PPG.txt` in two INDEPENDENT size-sorts — so on a fragmented night the two winners come from
  different hours. #2052 made those refusals *visible* and I then attributed them to the capture without
  checking whether my own file selection could manufacture them: a tool artifact reported as a data verdict,
  which is the class #2044/#2052 exist to prevent, committed one layer up. Verified independently before
  building (largest-pair / best-pair / night-level, my numbers ≡ Heron's on 4 spot-checked nights: 08-28
  0.00/6.31/23.75 h · 08-20 0.00/0.04/19.40 · 08-16 0.00/6.02/6.08 · 07-29 0.00/0.54/3.11).
  **Fixed by pairing fragments on temporal OVERLAP** (spans from an 8 KB read at each end, never a parse;
  largest-of-each remains the default so single-fragment nights are byte-identical). Measured on the 48-night
  tree: bare "no overlap" refusals **15 → 0**, 14 nights newly score, 27 of 29 previously-scoring nights
  unchanged, and the 2 that changed did so on strictly greater overlap (07-31 0.65→0.87 h, n 1029→1245,
  narrowSD 38.1→29.0; 08-18 0.86→1.54 h, n 315→1982, mode 355→815 ms ⇒ artifact refusal — ECG side
  unchanged, a PPG fragment swap, and NOT a clock-step artifact: 3,461,952 samples scanned, zero
  sensor-counter steps >2000 ms, max phone-stamp backward jump 554 ms).
  ⚠️ **NOT concatenating fragments per stream** (Heron): a concatenated train spans the inter-fragment gaps
  and a lag computed across a gap is meaningless. Per-pair scoring only.
  **2026-08-20 still refuses, and legitimately** — its trains are genuinely disjoint (R 04:28–04:34 vs feet
  04:36–05:00, disjoint by 2 min; the other PPG fragment holds 2 feet). A ruling to re-word this as a
  beat-count failure was declined: 0.04 h was FILE-span, not train-span, and printing it would have stated an
  overlap the trains do not have. The refusal now carries its own extents and gap instead, and the selftest
  requires them, so the bare phrase cannot return.
  Sibling defect fixed in the same function: the pick comparator called `readFileSync(b).length` INSIDE the
  sort — every candidate fully read O(n log n) times to learn a size (237 PPG fragments on 08-16). `statSync`.
- **§2.4 dormant sweep — EXECUTED 2026-09-02 (Osprey): ZERO false flags.** 23 real `dormant: true` entries
  (motiondex 2 · ppgdex 21 · ecgdex 0), each checked against its id, label and aliases in that node's
  app/render/dsp. #1455's two false flags were already corrected by F4; nothing else is silently live.
  ⚠️ **Extractor caveat, because my first pass reproduced §2.4's own error class:** walking back from each
  `dormant: true` occurrence to the nearest `ident: {` attributed a flag to `ecgdex lfhf` — a live, surfaced,
  guide-carded metric — because the match was inside a COMMENT quoting the phrase. Raw grep counts over-read
  for the same reason (motiondex 4 vs 2 real, ppgdex 22 vs 21). A dormant sweep must be comment-aware; the
  check that caught it was reconciling the grep count against the extracted id count and chasing the gap.
- *(Closed while drafting: DEEP-AUDIT-II §12.1's fallen FALSE-POSITIVE row was already re-stamped by #2062 —
  checked in `git show 3411f069`, not assumed.)*
