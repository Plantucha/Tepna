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
| 1.9 | **new (from 1.5)** | ~~`detectBreaths().breathRate` divides by WALL duration~~ — **FIXED 2026-09-02 (Osprey).** Now `breaths / mask-on seconds`, matching every sibling ventilation figure beside it (`rrMaskOn`, `tvMaskOn`, `mvMaskOn`, `snMaskOn`, `flMaskOn`), numerator gated too — breaths "detected" while the mask is off are noise crossings, and counting them against a smaller denominator would over-correct. The measured window is surfaced beside the rate as `breathMaskOnSec` (CLAUDE.md §7's ppm rule generalised: never quote a rate without the window it was measured over), and a set with no pressure lane REFUSES with a reason rather than dividing by the recording length. ⚠️ **Two sites and a third object.** `breathRate` is computed per-session (~1180) AND pooled at night level (~1441), both dividing by wall; the export reads the NIGHT one, so fixing only the per-session site changed nothing observable. The night aggregator reads `s._pool`, a lightweight object SEPARATE from `metrics`, so the denominator had to travel there too — until it did, the twin returned `null` with `maskOnSec 0`. Half-wired twice in one unit; enumerating every reader of `breathRate` (dsp ×2 · registry · render tile · fusion row) is what ended it. **Committed twin `cpapdex_maskoff_twin_{BRP,PLD}.edf`** (`tools/gen-maskoff-twin.mjs`): 20 min recorded, mask on for the first 10, ~150 breaths in the on-half. Pre-fix **7.5** br/min, fixed **15.0**; mutation-checked — restoring the wall denominator reds 4 of the group's 5 assertions. **The real corpus is silent, and that is now measured rather than claimed:** mask-on was 1.000 on all 24 nights §1.5 folded, and across every committed CPAP golden the fix moves exactly ONE rate — 16.8 → 16.9 on the synthetic EDF golden, a rounding shift on a ~full-mask-on record — everything else purely additive. | Osprey — **DONE** |
| 1.10 | **new (from 1.5)** | ~~`respFromEDR` substitutes a hardcoded `15`~~ — **FIXED 2026-09-02 (Osprey): it REFUSES now.** The value was worse than one unmarked substitution, it was two stacked: no dominant EDR period ⇒ echo the Lomb `respHint`; hint out of range ⇒ the constant **15**. The first is self-contradictory — the method's own comment says the rate is measured *"not echoed from the Lomb hint"*, so its stated independence held only on the nights it succeeded. Now: `respFromEDR = null` plus `respFromEDRReason`, carried into the export and rendered as **"no estimate"** on both app surfaces (the pill used to print `null br/min`). `f0` deliberately keeps its 0.25 Hz analysis centre so `crcPLV`/`couplingStrength` are untouched — nulling it would silently move a different metric inside a unit about the breath rate; whether a PLV computed at an ASSUMED centre is quotable is filed as **§1.11**, not answered here. **Committed twin required and built (§2.1):** no committed input took the branch — the clean twin carries 0.25 Hz baseline wander and its rich golden pins 16.3 — so `synthetic_ecgdex_flat_edr.txt` is the clean twin's morphology with the periodic drivers removed AND beats quantised to exact sample boundaries. Pre-fix code returns **11.1** on it (the hint echo), current code returns null. ⚠️ Two constructions FAILED to reach the branch and are recorded so nobody retries them: broadband noise gave a 19.9 br/min "period" (band-passed noise autocorrelates above the 0.1 floor) and a noiseless un-quantised train gave 7.4 (sub-sample phase jitter modulates the sampled R amplitude). A real clip from 2026-07-02 was staged and then REJECTED: real ECG recordings are not committed here (only synthetic are; the equiv leg's clip is gitignored). 🔴 **And this CORRECTS §1.5's own figures.** §1.5 excluded both nights whose rate was exactly 15.0 as fallbacks, detecting them by `=== 15.0` — the test it flagged as unable to separate a real 15.0 from the constant. Run against the fixed code: **2026-07-02 genuinely refuses; 2026-07-06 MEASURES 15.0.** So n = 22 → **23**, MAE 1.90 → **1.82**, LoA width 9.58 → **9.41**, constant-15 control 0.80 → **0.77**. Both bands still fail and the constant still beats the estimator: the re-tier verdict is unchanged, the registry stamp is corrected in this PR. | Osprey — **DONE** |
| 1.11 | **new (from 1.10)** | **`crcPLV` at an ASSUMED 0.25 Hz centre — MEASURED 2026-09-02 (Osprey): QUOTABLE. No code change, by assignment; the number goes to the owner before any fix is proposed.** §1.10 left `f0` falling back to 0.25 Hz rather than nulling it, which is honest only if the resulting PLV is still worth quoting. Pre-registered band (frozen before the first number, `s1.11-prestatement.md`): per-night `shift = max−min` of `crcPLV` over the sweep ∪ the night's own default centre; across nights `SD_night` = SD of `crcPLV` at the default. **shift > SD_night ⇒ not quotable; ≤ ⇒ quotable.** **Result, n = 24, sweep 9–24 br/min (0.150–0.400 Hz) at 3 br/min steps:** `SD_night` **0.0387**, median per-night shift **0.0060** (**15.5 %** of `SD_night`), max shift **0.0100** (25.9 %). The assumed centre costs about a sixth of the spread the metric already carries between nights, so §1.10's deferral **stands** and `crcPLV` may be quoted at the default centre. **The pre-registered trap did not fire:** a uniformly-floored statistic would be stable for the trivial reason that it cannot move (`defined-is-not-informative`), so nights with default PLV < 0.05 were to be reported separately — there are **zero**; the range is **0.182–0.326**. Stable here means insensitive, not empty. **Paired per-night, `default/shift@centre` (`ref` = `respFromEDR` refuses, so the centre IS 0.25 Hz):** 06-06 0.229/0.007@17.8; 06-07 0.240/0.007@ref; 06-10 0.185/0.009@7.4; 06-11 0.188/0.005@ref; 06-12 0.187/0.005@14.7; 06-14 0.236/0.008@ref; 06-15 0.199/0.006@ref; 06-17 0.196/0.006@ref; 06-20 0.182/0.005@ref; 06-24 0.235/0.006@17.3; 06-25 0.194/0.005@15.5; 06-27 0.206/0.005@ref; 06-28 0.219/0.005@ref; 06-29 0.285/0.006@ref; 06-30 0.249/0.008@ref; 07-01 0.231/0.006@16.9; 07-02 0.223/0.006@ref; 07-04 0.199/0.005@15.6; 07-06 0.252/0.007@15; 07-07 0.195/0.005@ref; 07-08 0.224/0.006@10.5; 07-09 0.323/0.010@17.2; 07-12 0.326/0.009@ref; 07-13 0.223/0.007@20. ⚠️ **How the sweep was driven, and why that is not a code change:** no centre override exists — `f0` is a local `const` in `cardiorespCoupling` (`ecgdex-dsp.js`) and neither `compute` nor `analyze` takes one. The sweep patches the DSP **text in memory** inside the harness's vm realm (the same technique §1.9/§1.10's plant-checks used to run `origin/main`'s DSP beside the working one); the shipped file is untouched and this unit ships no code. Recorded in the pre-statement as an amendment **before** any PLV was computed, so it cannot later read as if the tool had supported a sweep all along. ✅ **The harness was verified against a known answer before the result was read** (`verify-the-plant-was-seen`): on the **13** nights where `respFromEDR` refuses, the default centre *is* 0.25 Hz = 15 br/min, so `defaultPLV` must equal the sweep point at 15 exactly — **13 of 13 match to 1e−9**, and the nights whose measured rate is far from 15 (06-10 at 7.4) differ by the most. Without that check a patch that silently failed to bind would have produced a flat sweep and the same QUOTABLE verdict for the opposite reason. **Residue:** one night (06-10) has a measured centre of 7.4 br/min, **below** the swept floor of 9; its shift (0.009) is computed against its own default and is already among the largest three, so widening the floor moves nothing. | Osprey — **DONE** |

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

**SWEPT AND GATED 2026-09-06 — 0 of 23 suspect, and the sweep is now a mechanism.** Run across all 8
registries against each node's `render|app|fusion|overview|chartbadges` sources: **0** dormant ids or
admissible aliases occur. The two #1455 flags are already corrected, so the sweep's finding is a clean
negative — which is exactly why it is now an assertion rather than a one-off: the repo's habit is
finding a defect and not gating it, and a swept-once invariant decays silently.
⚠️ **THE FIRST RESULT WAS VACUOUS AND THE ANTI-VACUITY CONTROL CAUGHT IT.** A standalone version
resolved several registries to ZERO source files and reported a confident *0 of 23* having examined
nothing — `PPG_REGISTRY` (21 dormant) and `MOTION_REGISTRY` (2) both matched no source at all, i.e.
every dormant entry in the fleet. The gate therefore carries a positive control: a live id must be
findable by the SAME regex (316 of 497 today), or a clean result means only that the search is broken.
⚠️ **AND IT IS THE SECOND SITE §2.6's RULE WAS ASKED TO GENERALISE TO.** Written without §2.6's alias
admission rule, this scan's first run flagged `motiondex.uprightFrac via "upright"` — the identical
`POS_ORDER` posture-enum false positive, reintroduced by a new scan that had not inherited the rule.
The id is always admissible (a code identifier, not a word); an alias only if multi-word or ≥ 8 chars.
Plant-tested both ways: mark a live surfaced metric `dormant:true` → reds naming it; restore → silent.

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
**TRIAGED 2026-09-03 (Magpie) — HALF OF THIS IS ALREADY BUILT, and two of the numbers below are wrong.
Read this block before sizing the item.**

`tools/formula-constant-audit.mjs` already IS the numeral-keyed extractor this section proposes, and it
already parses the **same `<div class="ft">`** element named here. Measured by running it, not inferred:

| | |
|---|---|
| guides swept | **7 of 7** — every guide, not one |
| formulas parsed | **388** |
| constant-bearing | 68 |
| flagged | 5 (the `6.7` family is a documented false positive in the tool's own header) |

So **"The other 7 nodes are unswept" is FALSE for the `.ft` corpus** — that sweep exists, runs across
every guide, and carries hard-won defences worth reusing rather than rediscovering (strict `&#xNN;`
decoding, because a lenient decoder silently repaired an unterminated reference and reported a broken
card clean; no trailing-zero trimming, because `660`→`66` matched any digits and lost two real flags;
glob `<node>-*.js` and PRINT THE DENOMINATOR, because a hand-listed corpus read 2 of 8 files).

**Also: there are SEVEN guides, not eight.** MotionDex has no reference guide at all — so the eighth is
not unswept, it does not exist, and any gate keyed to "all eight" would pin a population that cannot be
satisfied.

**What is GENUINELY unbuilt, and it is the larger half.** The tool reads `.ft` and treats it as a
formula; it never opens `.md`, which is where the sentence telling a user what a number MEANS actually
lives — the thing this section is about. Measured per guide:

```
  CPAPDex   .ft=47   .md=47      OxyDex    .ft=114  .md=128
  ECGDex    .ft=53   .md=54      PpgDex    .ft=41   .md=41
  GlucoDex  .ft=38   .md=38      PulseDex  .ft=68   .md=68
  HRVDex    .ft=28   .md=28
  ── total  .ft=389 (swept)      .md=404 (UNSWEPT)
```

**404 descriptions, none of them ever compared to code.**

🔴 **RE-SIZED 2026-09-03 by BUILDING it (#2147) — and "point the existing extractor at `.md`" turns out
to be WRONG, including as I first wrote it one commit earlier. Measured:**

```
  404 descriptions · 108 claim-bearing · 161 claim values
       33 checkable
      128 REFUSED as unresolvable at whole-node corpus scope   (79%)
```

**A short integer cannot be checked against a whole node at all.** `constantPresent` is a substring test
over ~717 kB of `<node>-*.js`, and a planted-WRONG `87` reports *present* under every strategy tried —
plain, word-boundary, **and** comparison-context. Prose asserts precisely those: `below 90%`, `5-minute`,
`1 Hz`. The `.ft` sweep is sound only because `distinctiveConstants` restricts it to floats or ≥3 digits,
which is exactly the population prose does NOT use.

So the reach is **21%**, not "most of it", and the remainder is **not blocked — it is a different and
larger unit: scoping the code corpus per METRIC** (a card's claim checked against that metric's own
implementation) rather than per node. Size it as that, not as a filter tweak. #2147 ships the extraction
plus an explicit REFUSAL for the 128, so the shortfall is on the page rather than passing silently.

The structural-claim blind spot below stays entirely open on top of this, and is the part no numeral key
reaches at any corpus scope.

⚠️ One caveat on reusing it directly: `.md` is prose, so its numerals are far more likely to be
incidental ("n=2,743", a year, a citation page) than `.ft`'s are. Expect a worse false-positive rate
than the 5-of-68 above and design the filter before quoting a hand rate from it.

_Original text follows._

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

### 2.6 The dormant-surface alias matcher: an alias shorter than a word is not a surface token — **CLOSED 2026-09-06**
MotionDex `uprightFrac`'s bare alias `upright` matched a posture ENUM value in `POS_ORDER` — a false
positive. Matcher (#2072) now admits the label always, an alias only if multi-word or ≥ 8 chars; negative
control keeps the ECGDex pair. Generalise to any label-driven scan.

**MEASURED 2026-09-06 — there is nothing to generalise TO, and the real hole was elsewhere.**
The suite contains exactly **ONE** alias-driven scan (this one), so "generalise to any label-driven
scan" had no second site: a sweep would have found zero and read as thorough. What the measurement did
find is that the rule is **asymmetric** — an alias needs multi-word-or-≥8-chars, the **label is admitted
unconditionally** — and a bare short *label* would false-positive on a quoted enum value exactly as
`upright` did, with nothing to stop it. Exposure today: **0 of 23** dormant entries carry such a label,
so the exemption costs nothing now; but **116 of the fleet's 520 labels** are bare words under 8 chars
(`ODI`, `SD1`, `T90`, `QTc`, …), so the day any one of them is marked dormant the gate starts crying
wolf — which is how a gate gets deleted. Closed by asserting the **precondition** rather than sweeping
for a hazard with no instance: a new assertion in the same group names any dormant entry whose label is
a bare word < 8 chars. Plant-tested both ways (relabel a dormant entry `ODI` → reds and names it;
restore → silent). It forbids no authoring — it reports that the scan cannot verify that entry, which
is a fact about the gate, not about the metric.

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

**The timeout is NOT the defect and is not tuned.**

⚠️ **AND NEITHER IS UNBOUNDED CONCURRENCY — this paragraph used to say it was.** It read *"the defect is
unbounded concurrency over 81 child processes; a pool fixes the class"*, and a bounded pool was written.
It was **not shipped**, because the uncensored measurement above says the constraint was never binding:
6.3 s under deliberately-induced load against a 120 s timeout. Shipping the pool would have been a fix
for a mechanism the evidence had already refuted — the third such mechanism in this section, and the
only one that would have been written into code where it reads as a settled diagnosis rather than a
guess. What shipped instead (#2093) is the INSTRUMENT: per-tool wall time, and `os.loadavg()[0]` at
sweep start and at each kill, which is what makes the surviving cross-session account falsifiable from
inside a single session at all.

#### FIRST OBSERVATION FROM THE INSTRUMENT — 2026-09-02, and it discriminates

The instrument fired on its first real failure, during an unrelated full-gate run:

```
  load average at sweep start: 18.75 (24 cores)
  ✗ tools/dsp-review-qwen.mjs  FAILED  — TIMED OUT after 120s (killed, SIGTERM)  [120.1 s]  [load 23.45 at the kill, 18.75 at start]
```

Three numbers, and each one does work the earlier reports could not:

- **18.75 at sweep start.** The box was already loaded *before this session's sweep began*, so the sweep
  did not cause the load it died under. That is the signature the cross-session account predicts and the
  one no amount of reasoning from inside a single session could previously supply.
- **23.45 at the kill**, i.e. not a low-load kill — so the account is **not refuted**. The pre-registered
  refutation (a kill while the box is otherwise idle) did not occur.
- **21 ok, 0 failed on an immediate standalone re-run at load 24.38.** The tool is not broken. Note this
  cuts against a naive "load causes it" reading too: it passed at *higher* load when it was the only
  thing running, which is why the account is about CONTENTION, not about the load number itself.

The tool that died is `dsp-review-qwen` — **the most expensive of the 81 at 3.6 s**, exactly as the
CPU-demand account predicts. A kill of a ≤0.30 s tool would have refuted it outright.

**This is ONE observation and is recorded as one.** It is consistent with the account and does not
establish it; a single instance cannot separate cross-session load from any other cause that correlates
with a busy box. The standing predictions are unchanged: `mutation-crawl` (4.10 s) should be the next to
appear, a ≤0.30 s tool timing out refutes CPU demand, and a kill on an idle box refutes cross-session
load. The value of the instrument is that each future kill now arrives with the evidence attached
instead of as a bare timeout.

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

⚠️ **Numbering note (Osprey, 2026-09-02).** Two sessions numbering into one `### 3.N` list produce **no
hunk conflict** — the sections land in different places in the file, git merges both, and the brief ends
up with two §3.6 and two §3.7. That is the §📌 stale-brief shape with the conflict-free signature, one
level down from a whole-section overwrite. **Before claiming a §N, `git log` the brief for rows added
upstream since your merge-base** — the hook checks the file, not the number you are about to reuse. Mine
were renumbered to §3.8/§3.9 after the fact, which is why this list is not in numeric order.

### 3.9 A green `run-tests` says NOTHING about the stamping lap when a unit ADDS a committed input
The two read DIFFERENT corpus roots. `tests/run-tests.mjs` resolves `uploads/` inside the checkout it runs in — your
worktree — while `tools/verify-fixtures.mjs` resolves `$DEX_UPLOADS` → the **PRIMARY checkout** → this checkout
(see [`docs/CORPUS-LOCATIONS.md`](../docs/CORPUS-LOCATIONS.md), which records why a worktree carries only the tracked
fifth of `uploads/`). Measured 2026-09-02 on §1.9: the new committed mask-off twin existed only in the worktree, so
`npm run check` went GREEN (twin found) while `verify-fixtures` went RED on that unit's own *"committed twin must be
present in every environment"* assertion — and correctly refused to stamp ANYTHING rather than stamp around a red suite.
**The trap is how it presents:** your own brand-new assertion fails, which reads as a bug in your test rather than a
corpus-locality fact, and the gate's green actively argues against you.
**Rule:** a unit that adds a committed input owes that input to the primary checkout (or `DEX_UPLOADS` pointed at the
worktree) BEFORE the lap — and the PR must say WHICH was done, because an untracked file written into the shared root
reads as another session's WIP to every other session until the PR merges and the root syncs.
**The durable fix is a RESOLVER change, not a placement rule (Kestrel, 2026-09-02):** `verify-fixtures` should
resolve COMMITTED inputs from the checkout it runs in, and only GITIGNORED corpus inputs from the primary — pointing
`DEX_UPLOADS` at the worktree instead would have lost the gitignored corpus for the same lap, which is why writing the
committed twin into the shared root was the honest form here rather than a workaround.

### 3.8 A REBASE can invalidate a verification while every line of your diff survives
`provenance/<Node>.json` in the conflict set means the rebase may bring SOMEONE ELSE'S `verifiedUnder` onto YOUR tree.
Measured 2026-09-02 on #2085: the rebase carried Magpie's ECGDex stamp `65e8a013d842` (earned on their code) onto a tree
whose `computeHash` is `5080c3b0eca4` (mine) — one push from shipping a corpus-backed fixture verified under code that is
not the code. **Every survival grep was GREEN**, because the defect is not in the diff, it is in the merge.
So the post-rebase check is NOT "did my change survive" but **"does the on-disk stamp still equal the tree's
`computeHash`"** — and if `provenance/**` is in the overlap, assume it does not and re-run `verify-fixtures`.
A DIFFERENT check from §1.10's, which was about my own edits moving the closure under a stamp I had just earned.
**Lead, not built:** `rebase-safe` auto-resolves `provenance/**` as generated and rebuilds, but `build.mjs` cannot write
`verifiedUnder` — so the rebuild silently leaves a stamp it did not earn. It should PRINT
`provenance/<Node>.json was in the conflict set → verify-fixtures owed on this tree` whenever a fragment overlapped.

### 3.10 The browser lane is not locally runnable the way CI runs it — ONE fact, and TWO still-open failures
**The verified fact.** `node tests/browser-gates.mjs` **starts no HTTP server** (0 hits for
`createServer`/`listen`). CI does, in the workflow step immediately before it
(`python3 -m http.server 8080 --bind 127.0.0.1 &`), so the tool is correct in CI and simply cannot load a
page locally. **Serve the directory yourself before running the lane locally.**

⚠️ **Kestrel's port-contention hypothesis is REFUTED, and stating that is the point.** Several sessions
run gates at once, so contention was plausible and would have sent me hunting a peer's process. Nothing
in the tool listens, so there is nothing to contend for. A contention hypothesis and a no-server fact
predict the same silence; only reading the source separates them.

🔴 **But the no-server fact does NOT explain what was actually observed, and an earlier draft of this
section said it did.** Two corrections, both from re-reading the logs after Kestrel pushed back:

1. **The captured failures never reach navigation.** Both surviving logs die at
   `browserContext.newPage: Target page, context or browser has been closed` — `browser-gates.mjs:36`,
   which is **before** the `page.goto` at line 46. The browser was gone by the time a page was requested,
   so a missing server is not what these runs hit. Candidates, none yet distinguished: a peer's
   pattern-kill (§3.5's live hazard), an OOM (this box OOMs under refolds), or a Chromium launch failure
   of the `/dev/shm` class the file's own line-30 comment already warns about.
2. **83 minutes is not a shape any of this predicts.** `page.goto` carries `timeout: 60000`, so a
   serverless run should reject inside a minute with a non-zero exit — not sit silently for over an hour.
   A short log ending mid-`run_main` trace says the process **died while writing its trace**, not that it
   waited. The duration remains **OPEN**.

**The lesson is not "I was wrong about the server" — that fact is verified and stands.** It is that I
attached a verified fact to a symptom it does not account for, and the section then read as closed. A
true premise and an unexplained observation can sit in one paragraph and look like an explanation; the
check is whether the premise **predicts the observed shape** (here: an error exit in 60 s, versus 83
minutes of silence), not merely whether it is true.

### 3.5 Kill only what you own; a pattern is not a name (Osprey / Kestrel, 2026-08-31 → 09-01)
A pattern kill hit a PEER's gate unit; a clearing sweep globbed `*check*.log` while the evidence sat in
`*vf*.log`; a superseded monitor kept firing with authoritative-sounding text. Standing rules, now in memory
(`kill-only-owned-pids`, `kill-by-pattern-hits-peers`, `superseded-monitor-still-fires`): stop only named
`systemd --user` units; after any reported kill re-check every sentinel log for a missing `EXIT=`; `TaskStop`
a retired monitor in the same turn you retire it.

---

## 4 · The standing empty cells — DEEP-AUDIT-VII opens HERE, not with a new charter pass

**Both cells are now addressed, and neither turned out to be what it said.** One was stale as written — the
lane it called unbooted is booted on every PR (§4.1). The other was real, and the measurement inverted its
expected direction: the fusion arithmetic is sound, and the null model errs toward SUPPRESSING findings
rather than inventing them (§4.2). Each cell's original text is kept below unedited — what it claimed is
part of the record.

1. ~~**The browser lane was not booted.**~~ **CLOSED 2026-09-02 (Magpie) — see §4.1.** The cell was true
   of the *audit session*, and false of the repo: CI boots the browser lane on every PR.
2. ~~**Integrator noisy-OR posterior · `effConf` · Poisson-null / event-coupling surrogate**~~ — **MEASURED
   2026-09-02 (Magpie), see §4.2.** The noisy-OR and `effConf` hold on 13/13 pre-stated properties; the
   Poisson null is mis-calibrated ~5× CONSERVATIVE under its own assumptions (λ overstates chance by 21 %),
   which suppresses real findings. A code fix is owed and is deliberately NOT in that unit. Historical
   framing kept below for the record — **three
   consecutive audits** unexamined. F11 fixed the grouping that feeds it; the arithmetic downstream has never
   had an executed lens. This is the largest unverified surface in the suite and it must be the FIRST finder
   in the next workflow, not the tenth.

### 4.1 "The browser lane was not booted" was true of the SESSION and false of the REPO — CLOSED 2026-09-02 (Magpie)

The cell above described the audit session's own reach and was then read as a property of the suite. CI
boots the browser lane on **every** PR: the `browser-gates` job runs `tests/browser-gates.mjs`, which drives
`Dex-Test-Suite.html?full`, `verify-provenance.html` and `no-network.html` under headless chromium. It is
not an optional lane and it is not new.

**Every render-coverage rig boots.** Run
[`33632991928`](https://github.com/Plantucha/Tepna/actions/runs/33632991928) (browser-gates on #2091, head
`ea3e1f33`) reported `✕ 1 failing 8313 passed 69 skipped 588 groups`. Reproduced locally at `8025e807`:
`✓ all green 8313 passed 69 skipped 587 groups`, `sameOriginStatus().bootSkips = []`,
`renderCoverageGroups = 12`. Same passed count, same skip count; the 588th group and the one failure are
#2091's own new group.

⚠️ **The CI run proves this on its own, and the argument is worth stating because it is an argument from an
ABSENCE.** `browser-gates.mjs:109` appends `[boot-skips: …]` to the summary whenever the list is non-empty,
and run `33632991928` carries no such suffix. That is a real negative rather than an unset variable:
`Dex-Test-Suite.html:773` initialises `window.__rcBootSkips=[]` as render-coverage *starts*, so reaching
`__rcState === 'done'` — which the harness waits for — guarantees the array exists. Had it been assigned
lazily on first skip, an empty print would have been indistinguishable from a rig list that was never built,
and the same green would have meant nothing.

**What the 69 skips ARE.** CI prints the count and no breakdown, so the number has been quoted for weeks
with nothing behind it. Enumerated from `ALL_GROUPS` (57 groups carry at least one ⊘), every one is
**lane-structural** — a check the browser physically cannot perform:

| n | cause |
|---|---|
| 12 | `uploads/` is gitignored — the corpus-backed equiv legs' committed inputs are absent |
| ~30 | Node-lane only, filesystem truth — `readdir`, `git ls-files`, `readClaudeMdClaims`, the docs-/release-/citation-ledger gates |
| 12 | the browser lane cannot ESM-import a `.mjs` tool (`rebase-safe` ×3, `land-pr`, `queue-doctor`, `commit-shape`, `capture-recapture`, `beat-injection`, PAT ×3, `MutTriage`, `NsrrStage`) |
| 8 | a module not co-loaded in this lane (`oxydex-fusion`, `ECGUI`, `analysis-stats`, the `*-render.js` headless legs) |
| 3 | no `process.env` in a browser |
| 1 | `node:vm` realm (the cohort worker) |

Eight of the 69 have an **empty detail field**, which is the shape that normally hides something. Checked
individually: all eight carry their reason in the row *name* instead (`MutTriage not in env (browser lane —
.mjs tool)`). No residue.

**The complement was measured, not assumed — and this is the half that mattered.** Each of those 69 rows
*claims* the Node lane runs it, and nothing had ever checked that claim; a group skipped in **both** lanes
would present exactly like the 69 above and would be a real hole. So:

| lane | result |
|---|---|
| browser (`?full`, local, `8025e807`) | 8313 passed · **69 ⊘** · 587 groups · `bootSkips []` |
| Node `run-tests.mjs`, no corpus | 8947 passed · **12 ⊘** · 572 groups |
| Node `run-tests.mjs`, `DEX_UPLOADS=<primary>/uploads` | 8990 passed · **0 ⊘** · 572 groups |

The Node lane's 12 off-corpus skips are a **subset** of the browser's 69 (the 11 Phase-9 equiv legs plus the
HRVDex recording block), and they are the documented corpus case, not a hole:
`uploads/` is gitignored, so those legs skip in CI **and** in any worktree, and the closing mechanism is a
`verify-fixtures` lap on the primary checkout plus `release.mjs` refusing to cut over an UNVERIFIED
corpus-backed fixture (see [`docs/CORPUS-LOCATIONS.md`](../docs/CORPUS-LOCATIONS.md)). Pointing the Node run
at the primary's corpus runs all twelve: **zero skips, +43 assertions** — the same +43 the primary checkout
has always carried over a worktree.

**So no group is skipped in both lanes with the corpus present, and §4 item 1 closes.** Note the shape of
what was actually wrong here: nothing was broken, and no fix was owed. The cell was a *stale observation*
that survived because "the browser lane was not booted" is unfalsifiable as written — it names no lane, no
run and no tree, so it reads as true forever. A cell that cannot be closed by evidence should carry the
evidence that would close it. **Reserve "hole" for a group skipped in both lanes with the corpus
present** — that is the only configuration in which a check is genuinely running nowhere.

**Residue, not blocking:** the CI summary prints `69 skipped` with no breakdown, so the one number a reader
gets is the one that cannot be acted on — a count without its filter, in the gate's own reporter. A
one-line change to `browser-gates.mjs` could print the skip causes grouped by tag, the way it already prints
boot-skips. Not done here: this unit is a doc close, and the reporter change belongs with a gate PR.

### 4.2 The Integrator fusion arithmetic — MEASURED 2026-09-02 (Magpie). The noisy-OR is sound; the Poisson null is mis-calibrated, in the SUPPRESSING direction

§4 item 2 named three surfaces unexamined across three consecutive audits. All three now have an executed
lens. **Bars were written down before any measurement** and are reproduced here with their results, so no
threshold below was chosen after seeing a number. This is a measurement unit — **no code changed**.

#### (a)+(b) noisy-OR and `effConf` — 13/13 properties hold

`combineConf` (`integrator-dsp.js:91`) and `effConf` (`:137`), driven over a planted grid
`{0, .001, .05, .2, .5, .73, .9, .97, .999, 1}`:

order-independent across all 1000 permuted triples (0 order-dependent) · a 0-conf source is inert over 100
pairs · `combineConf([])` → `null` while `[0]` → `0` (absence is not zero) · a non-finite entry is skipped,
not read as zero-evidence · all-non-finite → `null` · the 0.97 cap **saturates**, never inverts ·
`effConf ≤ conf` · a null `conf` → `null` · `sqi=null` is quality-**neutral** (≡ 1, not 0) · the fused value
never below the largest single input · out-of-range `conf` clamped.

🔴 **One pre-registered property was VACUOUS, and only a planted mutant said so.** The bar was written as
*"raising one cᵢ never lowers the output"* and tested exactly that — raising a **value** with the source
count held at 3. The mutant `v − 0.02·n` (a per-source penalty: literally "adding evidence lowers the fused
value", the defect the bar names) **SURVIVED**, because the source count never varied in any comparison the
check made. "Adding evidence" has two operationalisations and the bar covered one:

| | check | real function | the mutant |
|---|---|---|---|
| **a2a** | raise one input's value | holds (900 raises, 0 inversions) | **survives** |
| **a2b** | add a source | holds (1000 additions, 0 that lowered) | **caught** |

Both hold on the shipped code, so the finding is not about the Integrator — it is about the *instrument*.
Without the anti-vacuity pass this section would have reported "monotone, 900 comparisons, 0 inversions":
true, and empty. Every other property here has a mutant it demonstrably rejects, and the real function
passes all five controls first.

#### (c) The Poisson null — the prediction was FALSIFIED, and the real defect points the other way

`λ = nDesats · min(1, surgeRate·window)`; `belowChance = nConf===0 || nConf ≤ λ || P(≥nConf|λ) ≥ 0.05`
(`:1948–1954`), and `confirmedAHIReportable = !belowChance && nConf > 0` (`:2014`) — so **`belowChance=true`
WITHHOLDS** the index.

Burst parameters were fixed from real data before any p-value was computed. Across the 4 distinct committed
ECGDex nights carrying absolute `tMs` (5.3–6.9 h spans, 4.5–7.4 surges/h): **Fano 1.46 at 5-min bins, CV of
inter-arrivals 1.40** — real surges are genuinely over-dispersed (Poisson ⇒ both 1.00). The simulation drives
the **real `fuseApneaEvents`** through the real `normalizeFile` ingestion; N = 2000 nights per condition,
6.5 h, 60 desats, 6.2 surges/h, 75 s window — the corpus's own geometry.

| condition | published rate (`belowChance === false`) |
|---|---|
| **c1** homogeneous Poisson — the code's OWN assumption | **0.95 %** |
| **c3** bursty, same total rate, σ = 15 / 37.5 / 75 / 150 / 300 / 600 s | 0.00 / 0.00 / 0.00 / 0.00 / 1.40 / 0.00 % |
| the code's own α | 5 % (95 % CI at N=2000: **[4.04 %, 5.96 %]**) |

**c1 is the finding.** Under its own assumptions the test publishes at **0.95 %** against a nominal 5 % —
five times more conservative than it claims, far outside the CI. Quantified at the source over 1500 null
nights: **λ = 8.28 against E[nConf] = 6.84, a 21.0 % overstatement of chance.** 6.6 pp of that is the linear
approximation — the code uses `min(1, rate·win) = 0.1292` where the true P(≥1 surge in the window) is
`1 − e^(−rate·win) = 0.1212`; the remainder is that overlapping desat windows compete for the same surges,
so distinct confirmations fall short of the independent-trials count λ assumes.

⚠️ **The direction matters more than the magnitude, and it is the bad one.** An overstated λ makes
`belowChance` fire too often, so **real findings are withheld** — the same failure direction the brief
already records at `:1921` for the §1.2 surge-rate defect, and for the reason stated there: *"a number that
is too high eventually gets questioned, a missing one does not."*

🔴 **The pre-registered prediction was WRONG, and is recorded as wrong.** Both the coordinator and I
predicted clustering would make the memoryless null **anti-conservative** — a too-low `pSpurious` publishing
a chance finding. It does the opposite: clustering makes it **more** conservative still. Mechanism, measured
rather than reasoned — at a fixed total surge count (41.0 bursty vs 40.6 homogeneous, verified, so "same
rate" is a checked fact and not a generator assumption), the number of **distinct 75 s-separated** surges
collapses from ~35 to **~27**. λ is built from the raw surge COUNT, but a confirmation needs a surge in a
*distinct* window — so clustering cuts achievable `nConf` while leaving λ untouched. The realistic null sits
*further* from publishing, not closer.

**`EventCoupling` does not cover this**, and that argument stands whichever way c3 had gone: `:1961` states
the λ "ignores the surges' internal structure", and `EventCoupling` is the answer to exactly that — but it
is documented as *additive; does not change reportability*, so the headline `belowChance` still rides the
memoryless null. A mitigation that does not reach the reportable path is not a mitigation of it.

**Discreteness — why no KS statistic is quoted.** `pSpurious` is discrete; the shipped fusions read
`0, 0, 0, 0.401, 1`, with atoms at exactly 0 and exactly 1. A KS against a continuous Uniform reds on that
support by construction and would have been a statement about the support, not the calibration. The
published-rate comparison against the code's own α needs no continuity assumption, so that is what is
reported.

**Owed, as its own PR (not done here):** λ should use `1 − e^(−rate·win)` rather than the linear
over-approximation, and the residual competition effect should be modelled or stated. Both change a
reportability gate and must carry their own fixture lap.

### 4.2b The λ fix — SHIPPED 2026-09-02 (Magpie). And the σ=75 s "confirmation" that was not one

§4.2 measured the defect; this is the fix, and the road to it is worth more than the patch.

**What shipped.** The chance-null is now circular-shift surrogates of the real surge train, scored
through `_matchDesatsToSurges` — the SAME function that produces the published `nConf`. A null that
models a different statistic than the one published is the original defect; sharing the function makes
that mismatch impossible by construction rather than by review. Shifts are EventCoupling's fixed
prime-second set (`shiftsForAlpha(0.05)` → B = 80), so there is **no PRNG and no seed** and identical
inputs reproduce identical bytes. The shift happens in **covered-time coordinates**, so no surrogate is
placed in a recording gap where nothing was observing. The analytic λ rides along as
`expectedConfirmedAnalytic`, now with the exact `1 − e^(−rate·win)` term.

| | published under the code's own homogeneous null |
|---|---|
| shipped before | 0.95 % |
| after | **4.85 %** (attainable size 4.94 %, CI [3.99, 5.89]) |

Controls both fire through the same path: a planted perfect coupling reaches the floor exactly
(p = 1/81 = 0.0123), 300 planted null nights average p = 0.565. Cost 58 ms/night at B = 80.

🔴 **A "confirmation" that was not one — the finding worth carrying forward.** The σ = 75 s row came in
anti-conservative (6.71 %, replicated at 6.75 %). Three causes were proposed and the first two were
wrong. I attributed it to missing coverage handling — impossible, since the simulation was gapless, so
coverage could not move that number. The coordinator attributed it to the wrap boundary splitting
clusters, and I built ARM B (buffered, no wrap) which returned 4.35 %, inside the CI. **ARM B was
confounded and was reported as a confirmation.** It removed the wrap *and* my generator's edge-clipping
of cluster offspring in one step, so it could not attribute anything to either. The 2×2 that settles it,
σ = 75 s, N = 2000:

| generator | circular wrap | drop-at-edge |
|---|---|---|
| offspring **clipped** at the span edge (the simulation's) | 6.75 % | 6.75 % |
| **padded**, observed on the interior (physical) | **3.00 %** | 4.35 % |

ARM C decides it: same generator, wrap → drop, and the number does not move at all. **The seam was
never the cause.** The cause was the simulation — clipping cluster offspring at `[0, SPAN)` depletes the
observed train's edges while surrogates shift interior clusters into them. A real recording does not
clip a physiological process; it truncates an ongoing one. The realistic configuration is therefore
padded-generator + wrap = **3.00 %: conservative, the safe direction**, against 0.00 % for the closed
form under the same clustering.

The general lesson is not about apnea. **A control that changes two things cannot attribute either**,
and it is most dangerous when it returns the expected answer — which is when it gets reported as a
confirmation and stops the investigation. The arm that settled this (ARM C) is the one that changed
exactly one thing and returned *no* difference.

**Two limitations, measured, neither fixed**, both written into the code comment that replaces the old
`:1961` note: (1) under real clustering the test is mildly conservative (3.00 % vs 4.94 % attainable);
(2) a circular shift destroys structure SHARED between the streams, so under a shared slow modulation —
a REM-dense hour dense in both — it is anti-conservative. The old homogeneous λ had the same blind spot,
so (2) is not a regression, but it is the assumption the next auditor should attack first.

**Real nights, paired and keyed.** 52 nights from the corpus root produced an apnea fusion (9 more had
no overlapping desat+cardiac pair and are excluded): **published before 0, published after 1, one flip,
none in the reverse direction.** The flip is 2026-07-04 — 16 desats, 55 surges, 4 confirmations, where
the analytic λ read 2.33 against a surrogate mean of 0.88, so p went 0.207 → 0.012 and an AHI of 0.51
that was withheld is now published. That single night is the user-facing direction of this change.

**Why that night's λ was 2.6× the surrogate mean — measured, because a gap that large beside a
withheld→published AHI cannot stand unexplained.** The first hypothesis was coverage: that the closed
form integrates chance over a span the recording never covered. **Refuted** — 2026-07-04 reads
`recordedFrac: 1, segments: 1`, a single unbroken segment with no uncovered span to integrate over.
The cause is clustering, and it is countable: **64 of that night's 95 five-minute bins contain no surge
at all**, with all 56 packed into the other 31 (Fano 1.37, CV 1.31 — at the corpus median, so a typical
night rather than an outlier). The analytic λ spreads those surges uniformly at 7.1/h and hands every
desat a 13 % coincidence chance, *including* the desats sitting in the surge-free two-thirds of the
night; the surrogates keep the real bursts, so a desat in an empty bin has no chance at all. This makes
the flip more credible rather than less: 4 confirmations occurred despite most of the night carrying no
surges, which is exactly what a null preserving that structure scores as improbable.

⚠️ **Zero fixtures moved, and that is silence by construction, not evidence.** `regen-integrator-goldens`
reports 0 moved because the only code-gated Integrator fixture is a *consensus* export with no
`apneaNullModel` — it cannot exercise this path at all. §4.3 is why. The executed evidence for this
change is the 52-night corpus run and the 13-assertion gate group, not the fixture ledger.

### 4.3 The Integrator's code-gated real-data surface was ONE fixture — CLOSED 2026-09-02 (Magpie), four committed twins

Surfaced while assembling §4.2's real-data leg, recorded separately because it is a standing exposure rather
than a calibration result. `provenance/Integrator.json` carries three fixtures:

| fixture | code-gated |
|---|---|
| `integrator_tch_golden.node-export.json` | **yes** |
| `integrator_fusion_2026-06-11.json` | no — `historical:true` |
| `integrator_fusion_2026-06-13.json` | no — `historical:true` |

A `historical` fixture is byte-pinned only (CLAUDE.md §🔏): its producing code has moved on, so its stability
is **not** evidence that current code is correct, and reading it as verification is exactly what the flag
exists to prevent. So the largest fusion surface in the suite is held by a single code-gated fixture. Note
`integrator_fusion_2026-06-13.json` carries `findings: 0` and an empty `apneaNullModel`, so it could not
exercise the §4.2 path at all even if it were code-gated.

#### CLOSED — `integrator_apnea_null_twins.node-export.json`, four twins, `outputHash c72e924109399ee0`

§4.2b proved the cost rather than argued it: a real behavioural change to the reportability gate landed
and `regen-integrator-goldens` reported **0 fixtures moved**, because nothing committed could express it.
Silence by construction. The twins close that. Inputs are rebuilt **in-code** by
`tests/apnea-null-twins.js` (seeded mulberry32, no clock read, `inputHashes:{}`) — the
`tch-golden-inputs.js` pattern, one builder shared by the regen tool and the equivalence gate so the two
cannot drift. Minted through `newRecord`, never hand-written; code-gated in `provenance/Integrator.json`;
8 assertions in the equiv leg, both lanes.

**FOUR twins, not two, and the mutant table is why.** The bar was that a mutant to the shipped path must
MOVE these bytes — a fixture that stays byte-identical has restated the exposure, not closed it. Measured:

| mutant to the shipped null | which twin sees it |
|---|---|
| revert the null to the analytic Poisson (pre-§4.2b) | all four |
| revert the exact term to the linear approximation | all four |
| lose the +1 p-floor correction | all four |
| **drop the covered-time shift (plain wall-clock wrap)** | **`gapped` only** |
| **null no longer scores the PUBLISHED matching (non-exclusive)** | **`contended` only** |

With the two obvious twins (`coupled`/`uncoupled` — the gate's two directions, because a corpus that only
ever publishes cannot fail against a null that publishes everything) the last two mutants were
**INVISIBLE**. So:

- **`gapped`** declares `recording.coverage.segments` with a 100-min hole. On a single-segment night
  `_coveredShift` and a wall-clock wrap are byte-identical — measured, not assumed — so without a real gap
  the covered-time work shipped in §4.2b had no witness at all.
- **`contended`** clusters desats 12 s apart so several compete for one surge. Everywhere else an exclusive
  and a non-exclusive scorer agree, which left **§4.2b's central claim — that the null scores the published
  statistic — unwitnessed by the corpus.**

⚠️ **A twin can be present and still examine nothing.** The first `contended` version spaced its clusters
45 min apart; every surrogate then scored zero, both scorers agreed trivially (surrogate mean **0.00**) and
the mutant stayed invisible. Densifying to ~11.5-min clusters made the scorer expressible. That is this
section's own failure class reproduced *inside the fix for it*, which is why the table above is recorded
rather than the file count: four files prove nothing, and a later reader cannot infer coverage from them.

**Presence is ASSERTED, not skipped.** `uploads/*` is gitignored, so the fixture reaches a fresh clone only
through an explicit `!` negation. If that negation is lost the file vanishes from CI, and a `T.skip` would
report green for a gate that examined nothing (§4b). The leg fails instead — verified by removing the file
and watching it red.

Verdicts, both directions and well clear of boundaries: `coupled` PUBLISHED at the floor (p 0.0123),
`uncoupled` WITHHELD (p 0.6296), `gapped` PUBLISHED, `contended` WITHHELD (p 0.1605). The
`coupled`/`uncoupled` pair holds event counts identical (surrogate mean 5.64 vs 5.65), so a verdict
difference cannot be attributed to event density. The two historical snapshots are untouched.

---

## 5 · Leads not assigned (cheap first probes)

- **A post-auth decode failure should be named by CAUSE, not left to read as a link stall** (Heron, from the
  O2Ring AES work-unit). Newer O2Ring-S firmware keys an AES/ECB session after AUTH; our BLE handshake writes
  AUTH `response=False` and reads no reply, so on such a ring the `0x10` ack and `0x04` frames fail the
  `[0xA5][cmd][~cmd]` header check or CRC-8 and the ring **connects, auths "successfully", and delivers no
  decoded frames** — indistinguishable from a bad link, and already reported as a stall by the path that
  exists. The misattribution cost is the whole point: an operator would chase a radio problem that is not
  there. The decoder should say so by name — after N consecutive header/CRC rejections on a link that
  authed cleanly, report "frames failed header/CRC after auth — firmware may key the session" rather than
  a stall.
  🔴 **CORRECTION 2026-09-03 (Heron): this lead previously read "#2084 arms the observable half (the
  ring's DIS firmware revision reaches `STATUS`)". THAT IS FALSE ON OUR HARDWARE and I wrote it.** #2084
  merged and deployed, and the first worn-and-connected night returned `firmware=ABSENT` with
  `BleakCharacteristicNotFoundError` in the daemon log: **our O2Ring does not implement DIS `0x2A26` at
  all.** The code behaves exactly as designed — it attempts the read, fails, logs the reason and leaves
  the field absent rather than fabricating one — and that correct behaviour cannot produce the
  observable. The recorded trigger "STATUS firmware field ≠ 2D010002" can therefore never fire. **An
  observable the device cannot supply is not a weaker trigger; it is not a trigger**, so this half is
  NOT armed and must not be counted as such.
  Why the tests missed it, which is the transferable part: `FakeGattClient` answered the DIS UUID
  because I taught it to, so five tests, four plants watched failing and 100 % coverage all bounded the
  FIXTURE and said nothing about the device — **the fake was more capable than the hardware.**
  Consequence: the decode-failure-by-cause half above is now the ONLY viable arming, because a reply to
  `0xFF` arriving at all is an observable the ring can actually produce — no DIS, no version string, no
  firmware field. It is in flight as #2133 (Finch). Cheap first probe unchanged: count those rejections
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
