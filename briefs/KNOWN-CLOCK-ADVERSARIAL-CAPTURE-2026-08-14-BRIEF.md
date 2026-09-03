<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** IN-PROGRESS (parked 2026-09-02 — drain triage, Kestrel: **the remainder is a CAPTURE CAMPAIGN, not code** — the null night and perturbed targets 6–8 need new box nights recorded under the preregistered frame, which is owner-authorized vigil time; owner: Heron, next step: one perturbed night + one null night on the box when the owner schedules it. Two done-when items below are ticked on the FOLLOWUPS brief's evidence — target 1 on the deliberate O2Ring buzz marker (2026-08-20, outside this frame but the evaluation the item asks for) and adapter held fixed across 257/258 sessions (2026-08-18). Phase 1 EXECUTED 2026-08-14 with two confirmed defects; verified 2026-09-01: **Defect A is REMEDIATED and gate-backed** — the `deviceDrawn` refusals now sit in every tool that spends a clock and the suite's `drawn-axis · source-scan` group pins them (checked green this date, per the documented-failure-is-not-open-failure rule) — while the null night, targets 6–8, and target 1's aperiodic-marker evaluation remain OPEN; target 1 is now UNBLOCKED by the proven buzz fiducial (5/5 in H10 ACC and 5/5 in Verity ACC on the pairwise night) but has not been run in this experiment's preregistered frame) · **Created:** 2026-08-14 · **Follows:** `ALLAN-DEVIATION-2026-08-12-BRIEF.md`, `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md` · **Affects:** `capture-host/`, `clock.js` §7, `ecgdex-dsp.js`, `ppgdex-dsp.js`, `oxydex-dsp.js`

> **Phase 1 EXECUTED 2026-08-14** — post-capture injection layer run against a real three-device box
> night. Preregistered criteria, results, and two confirmed defects in **§Findings** below. The
> remaining phases (injection at the `capture.py` write path, the null night, targets 6–8) are still
> PROPOSED.

# The one experiment: inject a known truth, run the production pipeline blind, and see what it recovers

**Owner's proposal, 2026-08-14.** A PPS-disciplined host captures H10 + Verity + O2Ring
simultaneously. Deliberately perturb one clock, the packet timing, and the beat detections by
**known** amounts. Run the whole production pipeline **blind**. Then ask it to recover eight things,
against **acceptance criteria written down before anyone looks at the output**.

That is the right experiment, and it is right for a reason worth stating plainly: every number this
suite publishes about time is currently **self-consistent but unanchored**. `hostAxis` measures the
device against the host. Allan describes the host against itself. Closure checks three sources
against each other. Nothing in that chain has ever been compared to a truth that was **known in
advance**, so every one of those gates could be wrong in the same direction and all of them would
still read green. This experiment is the only one in the backlog that can fail in a way the others
structurally cannot.

This brief does **not** re-argue the design. It records the **four measured facts that change it**,
because three of the eight recovery targets are not identifiable as posed, and one of the three
sensors is not a clock at all.

---

## 1 · What already exists (do not re-propose these)

| leg | state | where |
|---|---|---|
| host clock grading | **built** — `classify()` · `timebase_decision()`, stratum + skew bounds | `capture-host/host_clock.py` |
| Allan deviation | **built** — `adev` · `slope` · `slope_se` · `classify` · `stability` | `capture-host/allan.py` |
| device↔host axis | **built** — median-21, refuses <3 anchors or >5 % ppm, publishes `independent` / `spreadMs` | `clock.js` §7 `DexClock.hostAxis` |
| drawn-axis detection | **built** — ≥99 % of inter-sample deltas on one value ⇒ `timingSource:'none'` | `clock.js`, `ppgdex-dsp.js` |
| synthetic input generation | **partial** — `tools/make-synthetic-inputs.mjs`, `make-synthetic-edf.mjs` | `tools/` |
| **known-perturbation injection** | ❌ **does not exist** | — |
| **preregistered acceptance criteria** | ❌ **does not exist anywhere in the repo** | — |

The last two rows are the actual work. The rest is plumbing that already passes its own tests.

---

## 2 · Four measured facts that change the design

### 2.1 · 🔴 WITHDRAWN — the host does NOT fail the rate-trust gate; it passes it

Measured on the box, 2026-08-14:

```
Stratum         : 2                    Skew        : 0.011 ppm
RMS offset      : 0.000019485 s         Root delay  : 0.000422567 s
Reference ID    : C0A8007B (192.168.0.123)   ← itself Stratum 1
sourcestats 192.168.0.123 : offset −47 ns · freq skew 0.010 ppm · std dev 13 µs over 137 m
```

**🔴 This section originally claimed the box is stratum 2 and that `timebase_decision()` refuses to
grant rate-trust. Both halves are wrong.** Corrected 2026-08-15 by running the real path instead of
reading a terminal, and recorded here because it shipped in this brief, in the paper and in the index.

The box's own recorded decision, `2026-08-15 …_CLOCK.csv`:

```
trust=disciplined  absolute_ok=1  stratum=1  chrony_skew_ppm=0.004  timebase=host-disciplined
```

**It is host-disciplined and passes the gate.** The error: `chronyc tracking` reports `Stratum : 2`
meaning *this host's* stratum, and `parse_chrony_tracking` normalises that to the **server's** stratum
by subtracting 1 — so the value compared against `TIMEBASE_MAX_STRATUM` is **1**, not 2.
`host_clock.py`'s own docstring warns about exactly this in capitals (*"STRATUM MEANS TWO DIFFERENT
THINGS AND THEY MUST NOT BE MIXED"*), and
`test_chrony_stratum_is_normalised_to_the_SERVER_stratum` already pins it. There is no code defect and
no missing test; the claim came from comparing a number I read in a terminal against a constant I read
in a file, without running the function that connects them.

**Consequence for the follow-ups:** the item *"`TIMEBASE_MAX_STRATUM = 1` rejects the box it was
written for"* is void — its premise was this error.

But the more useful measurement is the ratio. The host's RMS offset is **19.5 µs**. BLE delivery
jitter into this same pipeline is **~100 ms, with 470 ms observed** (`clock.js` §7). The host is
already **~4 orders of magnitude** tighter than the transport that immediately follows it.

> **📊 RE-MEASURED ON THE LIVE BOX 2026-08-18 — the floor holds, and it has TWO numbers, not one.**
> `chronyc tracking`: **RMS offset 14.6 µs** (better than the 19.5 µs recorded above), system time 2.7 µs
> slow, last offset −4.7 µs, **stratum 2** locked to the stratum-1 LAN server at `192.168.0.123`
> (`+54 µs ± 1356 µs`).
>
> ⚠ **But `Root dispersion` is 1.47 ms, and that — not the RMS offset — is the bound on ABSOLUTE time.**
> RMS offset measures how tightly the local clock tracks its source; root dispersion bounds how wrong that
> source chain may be. Target 8's criterion says *"must include the 19.5 µs floor"*, and a run that quotes
> only the µs figure would overstate the host by ~100×.
>
> The conclusion is unchanged and survives either number — that is the point of stating both:
>
> | host figure | vs BLE ~100 ms | ratio |
> |---|---|---|
> | RMS offset 14.6 µs | tracking precision | **~6 800×** |
> | root dispersion 1.47 ms | absolute bound | **~68×** |
>
> So §2.1's "do not let a GPS/PPS hat gate the experiment" stands on the *conservative* reading too: even
> at 1.47 ms the host is two orders below the transport it feeds. **Report the pair.** Quoting 14.6 µs
> alone would be the same error as quoting a `ppm` without its span.

**So: putting a GPS/PPS hat on the box buys precision that BLE destroys in the next hop.** Do it if
it is cheap, but do not let it gate the experiment, and do not report it as the thing that made the
result trustworthy. The honest framing is the opposite — the experiment is a good test of whether
the pipeline can recover truth **through** a transport that is 10⁴ times noisier than the reference,
which is the regime it actually ships in.

**Open question this raises, worth answering separately:** is `TIMEBASE_MAX_STRATUM = 1` too strict?
A one-hop LAN chain from a real stratum-1 at 422 µs root delay and 0.011 ppm skew is, by every number
above, a better rate reference than the bound admits. The gate currently rejects the box it was
written for.

### 2.2 · The O2Ring is not a clock — so it is the **negative control**, not the third leg

The O2Ring's sensor timestamp is **synthesized** — constructed as `sample_index × an assumed rate`,
not read from an oscillator (`o2ring-timestamp-is-drawn`; `clock.js` publishes `timingSource:'none'`
for exactly this). Perturbing "the O2Ring's clock" and asking the pipeline to recover a frequency
error is a **category error**: there is no frequency to err.

This is not a reason to drop it. It is the **strongest single leg in the experiment**, reframed:

> **The O2Ring is the stream on which every recovery target must return REFUSAL.** If any
> perturbation produces a recovered ppm, a recovered offset drift, or an Allan slope read as
> device stability from the O2Ring, that is a **false positive on a stream that has no clock at
> all** — the most dangerous failure this pipeline can have, and the only one this experiment can
> catch by construction.

Two clocks (H10, Verity) + one known non-clock. The asymmetry is the point.

### 2.3 · Constant offset (target 1) is **not identifiable** from beat matching — this is the most likely way the experiment produces a confident wrong answer

Beat-time matching pins a clock offset **only modulo one heartbeat interval**
(`beat-trains-align-only-mod-rr`). Two beat trains offset by exactly one RR are indistinguishable
from two perfectly aligned ones. So an injected constant offset of, say, 800 ms sits inside the
ambiguity for any subject whose RR is near 800 ms, and the pipeline can report "recovered, error
≈ 0" while being one full beat wrong.

**Consequence for the design:** target 1's acceptance criterion **must be defined on an aperiodic
feature** — a deliberate marker, not the beat train.
⚠ **This line originally proposed "a tap artefact … a motion impulse visible in both ACC streams",
and that is wrong — corrected 2026-08-15 after the owner challenged it.** A tap on one device is a
LOCAL mechanical event: to reach a device on another body segment it must travel through tissue, which
damps and delays it. Measured (§4b below): a whole-body roll — far larger than a tap — produces no
alignable shared transient at all. A marker that relies on TRANSMISSION between body segments does
not work here. What works is **co-location**: strap the two devices together, produce one sharp
impulse so they are momentarily a single rigid body experiencing literally the same acceleration, then
don them. The clapperboard principle, and it needs no transmission. If it is defined on beats, the experiment reports pass/fail
on an unidentifiable quantity, and will do so *confidently*.

This is also why the **~3.3 s** phone-night H10↔Verity divergence was resolvable and a 0.2 s one is
harder: 3.3 s exceeds several RR intervals and the sign is unambiguous.

### 2.4 · Offset and frequency are degenerate below a span, and there are only **2 BLE adapters for 3 devices**

- **Degeneracy.** A constant offset and a constant frequency error are separable only over enough
  span; `ecgdex-dsp.js` already span-gates its `fs` correction at **2400 s** for this reason.
  Targets 1 and 2 must each state **the span at which the claim holds** — "recovered to ±X ppm" with
  no span is the same defect §7 of the Clock Contract already forbids for quoted ppm.
- **Radios.** The box has **two** USB BLE adapters (`hci0`, `hci1`; measured 2026-08-14, one link
  live at the time), and the capture path uses the UB500 that is known to go deaf
  (`vigil-box-ble-radios`). Three simultaneous devices on two adapters is possible but is itself an
  uncontrolled variable — **adapter assignment must be recorded per night and held fixed**, or a
  recovered "sensor-specific noise" term (target 7) will silently be an adapter term.

---

## 3 · The eight targets, and what each can honestly claim

| # | target | identifiable? | criterion must be stated on |
|---|---|---|---|
| 1 | constant offset | **only via an aperiodic marker** (§2.3) | marker residual, not beat alignment |
| 2 | constant frequency error | yes, given span | ppm **+ span + anchor count** (§7) |
| 3 | frequency wander | yes — this is what Allan is for | σ_y(τ) **slope class**, not a magnitude |
| 4 | packet loss | yes | recovered gap count/position vs injected |
| 5 | timestamp jumps | yes — `maxStepMs` exists for this | step localised to the right anchor gap |
| 6 | beat-matching errors | yes, if injected as labelled FP/FN | precision/recall vs injected labels |
> **📊 TARGET 6 RUN 2026-08-19 — 89 real streams, labelled injection, P/R against the labels.**
> `beat-error-recovery.mjs` now returns labels from its injectors and joins them to `correctRR`'s
> per-interval `flags` (a 1:1 join — the corrector substitutes, never deletes). Across the box corpus:
>
> | injected | rate | recall (median · min) | precision (median) |
> |---|---|---|---|
> | missed beats | 0.1 % → 5 % | **1.000** · 0.936 | 0.26 → 0.95 |
> | spurious beats | 0.1 % → 5 % | **1.000** · 0.972* | 0.58 → 0.98 |
>
> *min 0.500 at the 0.1 % rate, where one stream had 2 injections and caught 1.
>
> **Recall is the verdict: the shipped corrector catches essentially every injected beat error.** The
> low precision at low rates is NOT imprecision — it is base-rate arithmetic, and the null control
> proves it: on UNINJECTED real data `correctRR` flags a median **0.20 %** of intervals (its ordinary,
> correct work on real ectopy), and those flags count against injected-only ground truth. The model
> `P = f/(f + 0.002)` reproduces the measured curve within 0.08 at every rate (0.338/0.261 ·
> 0.718/0.640 · 0.911/0.889 · 0.962/0.946). **Precision vs injected labels UNDERSTATES the corrector**
> — the criterion is exactly as preregistered, and this is the caveat it needs beside it.
> Synthetic control (clean train, no background): P=1.000 R=1.000 (miss), P=1.000 R=0.993 (fp) — the
> base-rate explanation, run in reverse.
| 7 | sensor-specific noise | **confounded with adapter** (§2.4) | requires fixed adapter assignment |
| 8 | host-induced artifacts | yes | must include the 19.5 µs floor (§2.1) |

Target 3 deserves emphasis: **the acceptance criterion should be the Allan slope *class*, not the
number.** `allan.py classify()` already names the mechanism — τ⁻¹ jitter · τ⁻¹ᐟ² · τ⁰ floor · τ⁺¹ᐟ²
wander · τ⁺¹ drift. Injecting a known wander and recovering the right *class* is a far stronger
result than matching a magnitude, because the class is what determines whether averaging longer helps
at all.

---

## 4 · Preregistration — the part that makes this different from every gate already here

The suite's recurring failure class is **machinery that passes without exercising anything**
(`ui-export-paths-broken`). A blind run with criteria written afterwards would be one more instance,
dressed better. So:

1. **Write `acceptance.json` first**, commit it, and record its hash in the brief. Per target: the
   injected truth, the tolerance, the span/anchor count the claim is made at, and the **refusal**
   expectation for the O2Ring leg.
2. **The injector holds the truth; the pipeline never sees it.** Truth file written to a path the
   analysis run cannot read, revealed only after the recovery output is committed.
3. **A pre-committed NULL run.** At least one night with **zero** perturbation injected, unlabelled
   in the blind set. A pipeline that "recovers" a frequency error from the null night has failed,
   and nothing else in the design catches that.
4. **Report every target, including the ones that refuse.** A refusal that was *predicted* is a pass;
   a refusal discovered afterwards and reclassified as expected is not.

---

## 5 · Where to inject — this choice decides what is actually under test

| layer | tests | cannot test |
|---|---|---|
| post-capture CSV rewrite | DSP, clock contract, Allan, closure | the capture host itself |
| in `capture.py` write path | capture host + everything downstream | BLE stack, adapter behaviour |
| BLE/HCI level | everything | **cannot inject a clean known truth** |

**Recommendation: inject at the `capture.py` write path**, and separately record the raw BLE arrival
stamps so the transport's own contribution stays measurable. Post-capture rewriting is cheaper and is
the right first increment, but it leaves the capture host — the component with a 100 % coverage floor
and *no* end-to-end timing test — outside the experiment entirely, which would be the ironic outcome.

---

## 6 · What must NOT be done

- **Do not report a ppm without its span and anchor count.** The same H10 reads −20.3 ppm over
  373 min and −65.8 over 10.9 (§7). An experiment that recovers "the" frequency error has not
  understood what it measured.
- **Do not let the O2Ring leg be quietly dropped when it refuses.** Its refusal is a *result*.
- **Do not tune a tolerance after seeing the output.** If a criterion was wrong, say it was wrong,
  record the original, and re-run — do not edit `acceptance.json` in place.
- **Do not use the existing corpus.** Every raw night on hand is **phone-captured and has no second
  clock** (host-column spread 0.13–1.00 ms vs 101.89–5124 ms on box nights;
  `raw-corpus-is-all-phone-captured`). This experiment requires **new box-captured nights**.

---

## Done when

- [x] **VERIFIED 2026-08-16.** `experiments/known-clock/acceptance.json` is tracked, was committed in
      #1252, and its `sha256 b061d279…f2baff1586` matches the hash recorded below byte for byte. The
      preregistration is real, not asserted.
- [ ] ≥1 null night is in the blind set and the pipeline did **not** recover a perturbation from it.
      *(Correctly open — the null night is one of the phases the header lists as still PROPOSED.)*
- [ ] All eight targets reported, each with span/anchor count where it quotes a rate.
      *(Correctly open — targets 6–8 are unrun, and the Phase-1 table quotes no span/anchor counts.)*
- [✗] **TESTED AND FALSIFIED 2026-08-16 — this is Defect A, not an untested box.** The O2Ring did NOT
      refuse: on its real monotonic run it returned `ok:true`, `ppm 2765.5`, `independent TRUE` — a
      confident rate for a device whose PPG axis carries no per-sample device timing.
      **⚠ Wording corrected 2026-08-18 (#1460): the O2Ring is NOT "a device with no oscillator".** It has a
      clock and displays the time; `OXYFRAME.duration_s` is a device-side counter that measures **sub-ppm
      against the host for the first ~3 h** of a night, degrading only after the first BLE dropout. The
      defect is real and the refusal is still owed — but it is owed because the *PPG stream* is
      host-disciplined (`sensor timestamp [ns] = 0`), not because the hardware lacks an oscillator. The whole-file run refused only by luck (a
      counter reset makes the span negative, tripping the plausibility bound). **A preregistered
      prediction that fails is the experiment working**, and leaving it unticked read as though it had
      never been run.
- [x] **CLOSED 2026-09-02 via the FOLLOWUPS brief** (evaluated 2026-08-20 on the deliberate O2Ring buzz marker, stay-put + injection + three-estimator convergence — see its Done-when item 1). Target 1 is evaluated on an aperiodic marker, not on beat alignment. **Was open, and the
      results table's ✅ for target 1 was VACUOUS** — its criterion cannot fail, since `hostAxis`
      subtracts `r0` and a 1 000 000 ms offset passes `< 0.5 ppm` at float noise. Row re-marked `⊘`;
      see the amendment under the results table.
      **⚠ THE MARKER REQUIREMENT IS NOW MEASURED (2026-08-18) — read this before capturing another one.**
      Two owner-run tap sessions were attempted as the aperiodic marker and **both are unusable, for a
      reason that is not force, timing precision, or coupling**: the taps were *rhythmic*. Cross-correlating
      the two accelerometer magnitude traces on their own device axes over ±6 s returns a peak at −0.805 s
      that is only **2.26× the median lag correlation**, with competing peaks at −1.065 (84.8 %), −0.550
      (75.4 %) and −1.315 (74.8 %) — spaced **0.26 s apart, exactly the tap interval** — and a 50 %-of-peak
      band spanning the **entire ±6 s search range**. That is aliasing on the tap period: a periodic marker
      pins an offset only *modulo its own period*, the identical failure as beat alignment mod one RR, which
      is what this box exists to escape. **A rhythm is the one pattern guaranteed not to work.**
      What an admissible marker needs, each term measured rather than assumed:
      **(a) aperiodic** — deliberately irregular gaps (1 s, 4 s, 2 s, 6 s …), 6–8 events is sufficient once
      the spacing is unequal; **(b) rigidly coupled** — both devices on one hard surface, tapping the
      *surface*: worn on the body, the H10 saw the tap at **SNR 110×** while the Verity saw **9 mg against a
      3.8 mg floor (SNR 2.3×)**, i.e. no detection at all; **(c) quiet either side** — handling the devices
      raised the noise floors to **135 mg and 427 mg** (SNR 7.4× / 3.6×) versus **10 mg** when untouched.
      Resolution ceiling is one sample at the measured 51.8 Hz ⇒ **~±19 ms**, against the ~0.2 s the host
      route gives on box-captured nights, so the marker is worth capturing correctly — it is ~10× better
      than what it replaces.
- [x] **SATISFIED 2026-08-18 (FOLLOWUPS item 2):** every `Tepna_*_LINK.csv` records the adapter MAC and 257/258 sessions sit on one adapter; the outlier is header-identifiable. Adapter assignment is recorded per night and held fixed across the set.
- [x] **DONE.** The result is written up whether it passes or fails — a failed recovery is the more valuable
      paper, and `papers/dead-ends.html` is where it goes if so.

---

# Findings — Phase 1, executed 2026-08-14

**Substrate.** `vigil:/srv/tepna/captures/2026-08-13`, the night of 23:17 → 04:03 (4.75 h), all three
devices recording simultaneously, box-captured: H10 30,519 ECG packets · Verity 67,519 PPG packets ·
O2Ring 17,020 packets. Recovery under test: `DexClock.hostAxis`.

**Preregistration.** `acceptance.json`, written and hashed **before any run**:
`sha256 b061d2792c1ff8d605ec82ff9fd298d56ca40915877ab274aa1785f2baff1586`. Perturbations are
deterministic (no RNG) so every figure below re-runs exactly.

## Results against the preregistered criteria

| target | injected | H10 recovered | Verity recovered | criterion | |
|---|---|---|---|---|:--:|
| determinism | — | Δppm `0.00e+0` | `0.00e+0` | < 0.5 ppm | ✅ |
| **1 · constant offset** | +5000 ms | **Δppm 0.000** | **0.000** | < 0.5 ppm | ⊘ **VACUOUS — see below** |
| **2 · frequency** | +100 ppm | **−99.982** | **−99.974** | ±15 % | ✅ |
| 2b · frequency, small | +10 ppm | **−9.999** | **−9.998** | ±30 % | ✅ |
| **5 · timestamp jump** | +2000 ms step | maxStep **57.6×** | **30.2×** | > 10× | ✅ |
| 4 · packet loss | 30 % stride | Δppm −0.649 | **+6.485** | < 2 ppm | ❌ |
| plausibility | dev × 2.0 | **refused** | **refused** | `ok:false` | ✅ |

Frequency recovery is accurate to **0.02 %** at 100 ppm and **0.01 %** at 10 ppm, on 4.75 h of real
BLE-jittered packets. That is the headline pass.

**Target 1 behaved exactly as §2.3 predicted, and the prediction is the result.** A 5 s offset moved
the recovered rate by **0.000 ppm** — `hostAxis` subtracts `r0`, so a constant offset is removed by
construction and is **not recoverable from this estimator at all**. Anyone reading a `ppm` as
evidence about absolute alignment is reading a quantity that is blind to it by design.

> ### ⊘ AMENDED 2026-08-16 — that row was marked ✅, and the ✅ was VACUOUS
>
> The prose above is right and the table was wrong. **Target 1's criterion cannot fail**, so passing it
> is not evidence about anything. `clock.js:492` is `var r0 = pts[0].r` — divergence is measured
> relative to the first anchor, so a constant offset shifts every `r` by the same amount and is
> subtracted out exactly. Measured directly against `DexClock.hostAxis` on 200 synthetic anchors
> carrying a real +100 ppm error:
>
> | injected constant offset | recovered ppm | Δppm vs unshifted |
> |---|---|---|
> | 0 ms | −100.716809 | 0 |
> | +5 000 ms *(what was tested)* | −100.716809 | 2.8 × 10⁻¹⁴ |
> | −250 000 ms | −100.716809 | 6.7 × 10⁻¹³ |
> | **+1 000 000 ms** *(16½ minutes)* | **−100.716809** | **6.7 × 10⁻¹³** |
>
> A **sixteen-minute** offset passes `< 0.5 ppm` exactly as comfortably as five seconds, at float noise.
> The test cannot distinguish a working estimator from a broken one on this target, so its ✅ carried no
> information — and a reader scanning the table counts six passes and one failure.
>
> **The brief already knew this and the two halves contradicted each other.** Done-when box *"Target 1
> is evaluated on an aperiodic marker, not on beat alignment"* is **unchecked**, and §2.3 predicted the
> whole thing in advance. The ✅ is what a reader meets first.
>
> **This is the one place a vacuous pass is most expensive.** The entire method here is preregistered
> criteria — its value rests on a criterion being able to fail. One that cannot is worse than no
> criterion, because it launders "not measured" into "measured and passed". The row is now `⊘`, which
> is neither pass nor fail, and target 1 stays open until it is evaluated on the aperiodic marker §2.3
> specifies.
>
> **Generalisable, and cheap to apply to the remaining targets before they run:** for each
> preregistered criterion, ask *what injected value would make this fail?* If the answer is "none",
> the criterion is measuring the estimator's construction rather than its behaviour. Targets 6–8 have
> not been run yet, so this costs nothing to check now and cannot be retrofitted afterwards.

**Target 4 failed, and the failure is in the experiment, not the estimator.** Follow-up (`probe.mjs`):

| thinning at the same 30 % rate | H10 Δppm | Verity Δppm |
|---|---|---|
| stride `i%10>=3` | −0.649 | **+6.485** |
| reordered phase | −2.567 | +1.879 |
| **contiguous mid-gap** | **0.000** | **0.000** |

Contiguous loss — *which is what a real BLE dropout is* — has **exactly zero** effect on both
devices. The bias only appears under interleaved decimation, which does not occur in the wild. The
preregistered criterion caught a real sensitivity and then the mechanism showed it is unreachable;
without preregistration this would have been hand-waved in either direction.

## Defect A — `independent` is structurally fooled by a drawn axis (CONFIRMED, fix shipped)

`independent` was `spreadMs > 2 ms`. A counter synthesised as `index × an assumed rate` at **1 s**
granularity produces an enormous residual spread, so **the coarser the fabrication, the more
"independent" it read** — the discriminator detects the opposite of what it must.

Measured on the O2Ring's real monotonic run (16,910 of 17,020 packets):

```
ok:true   ppm = 2765.5   spreadMs = 48306.0   independent = TRUE
```

A confident 2765 ppm rate for a device with **no oscillator**. The whole-file run *did* refuse — but
only by luck: a mid-session counter reset makes the device span **negative** (−10,520 s against a
+17,102 s host span), tripping the ±50000 ppm plausibility bound. On the monotonic segment a node
would actually parse after gap-splitting, it sails through. Consumers that trust the flag:
`pat-gate.js:92` · `ecgdex-dsp.js:4301` (fs correction) · `integrator-dsp.js:5338` (skew decision) ·
`tools/pat-host-offset.mjs:408`.

**The separating quantity, measured over 381 arrival sidecars on the box tree:**

| population | files | modal-delta share |
|---|---|---|
| real clock streams | 356 | max **56.00 %** (Verity ppg; H10 ecg 40.79 %, H10 acc 0.06 %) |
| **DRAWN streams** | 25 | min **79.04 %** (O2Ring counter, Verity `ppi`) |

Nothing lands between. `CK_AXIS_DRAWN_SHARE = 0.67` sits in the gap: **0/25 missed, 0/356 false
positives.** A property of the data, like `CK_AXIS_INERT_MS`, not a tuned knob.

⚠ **`Verity ppi` is drawn at 100 % — a second fabricated stream, not previously flagged.**

## Defect B — the existing ≥99 % drawn test misses 20 % of drawn streams (CONFIRMED)

| threshold | drawn MISSED | false positives |
|---|---|---|
| **99 % (current, ppgdex-dsp)** | **5 / 25** | 0 / 356 |
| 95 % | 1 / 25 | 0 / 356 |
| **67 % (adopted)** | **0 / 25** | 0 / 356 |

A fabricated axis is only ~100 % concentrated when nothing interrupts it; **one counter reset, a
repeated stamp or a doubled delta drops a genuinely drawn stream to 79 %.** Do not raise the bound
back toward 99 %.

## What shipped, and the hole deliberately left open

`hostAxis` now computes the modal-delta concentration from the anchors it already holds and publishes
**`drawnShare`**, **`deviceDrawn`** and **`drawnReason`**.

**`deviceDrawn` does NOT gate `independent`, and that is a decision, not an oversight.** Folding it in
was implemented, run, and reverted: it reds **11 assertions**, including ECGDex's planted-drift
recovery — a real feature whose fixture legitimately uses a uniform device axis (`devMs = i * 1000`),
which is by construction indistinguishable from a fabricated one. The detector is right about real
data and wrong to be load-bearing there, **because a test fixture is not a recording.** This follows
the precedent `independent` itself shipped under: additive first, consumers migrate deliberately.

**So the hole is still open**: `independent` remains `true` for a drawn O2Ring axis, and the four
consumers above still read it. The new test group asserts that state explicitly (`KNOWN HOLE ·
independent is still spread-only`) so it cannot be silently "tidied" shut without the consumer work.

**Next:** migrate consumers to `deviceDrawn` node by node, re-cutting each node's fixtures to a
realistic device axis first — `integrator-dsp.js:5338` is the highest-harm one, since it is the leg
that decides whether two devices sit on one timebase.

---

# Phase 2 — the corpus run, executed 2026-08-14

Phase 1 was one night and a scratch script. Phase 2 replaces both: a repo-owned tool
(**`tools/known-clock-recovery.mjs`**, self-tested) over **395 sidecars / 21 nights / 3 devices**,
61 streams with ≥500 packets. Paper: **`papers/known-clock-recovery.html`**.

## The instrument was validated against an outside reference first

`capture-host/allan.py` underpins every stability claim here and had only ever been known-answer
tested against **its own** synthesised noise — which proves self-consistency, not correctness. Checked
against **`allantools` 2024.06** (Riley / NIST SP 1065) on identical phase series: worst per-τ relative
difference **4.78 × 10⁻¹⁴**, slopes identical to four decimals across white-PM, white-FM, RW-FM and
drift. The stability instrument is not the weak link.

## Two bugs in MY OWN tool, both found by measuring rather than reasoning

1. **A guard on a field that does not exist.** The tool read `stability.ok`; `stability` has no `ok`
   member — it is the object or `null`. Every stream therefore recorded a `null` noise type, and the
   first corpus run reported wander as **"(none)"** across all 61 streams. That is this repo's named
   failure class committed by the instrument built to hunt it: **a check reporting about something it
   never examined.** A regression assertion now requires the field to be *populated*, not merely absent.
2. **A sign error in the self-test, not the code.** The first `--self-test` failed at **−198.7 %** —
   exactly the injected sign, doubled. Injecting +100 ppm on the *device* must recover **−100 ppm**
   (`r = host − dev`). The expected value now travels **in the output record**, not a comment.

A third correction was to an assertion I had written too strongly: `classify()` returns `noise: null`
when the slope SE cannot discriminate. That is its honest refusal and must not be asserted away, so the
test now requires a computed *slope*, named or not.

## Results at corpus scale (41 streams with span > 300 s)

| target | result | verdict |
|---|---|---|
| null control, all 61 | max abs err **0.00 × 10⁰ ppm** — bit-identical | ✅ |
| constant offset (1 / 5 / 60 s) | **exactly 0.000 ppm**, all 61 | ✅ unidentifiable *by construction* |
| frequency ±1 … ±500 ppm | median rel err **0.029–0.094 %**, p90 ≤ 0.55 %, worst 1.06 % | ✅ linear, unbiased |
| contiguous loss 10/30/**50 %** | **max abs Δ 0.00 ppm**, all 61 | ✅ |
| interleaved decimation | p90 up to 67 ppm, max **1115 ppm** | ⚠ not a real dropout |
| timestamp step 200 ms | median ratio **1.0×** — invisible | ❌ floor found |
| timestamp step 2000 ms | median 13.0×, but >10× on only **51 %** | ⚠ |
| wander 0.5 / 5 ppm-step | slope −0.990 → −0.968 / **−0.937**, never leaves τ⁻¹ | ❌ not recoverable |

## The central finding — σ_y(τ) exceeds the rate being quoted

| span | n | med \|ppm\| | med σ_y (ppm) | resolved (\|ppm\| > σ_y) |
|---|---|---|---|---|
| < 300 s | 4 | 105.9 | **2137.5** | **0 %** |
| 300–3600 s | 17 | 50.4 | **489.8** | **6 %** |
| > 3600 s | 24 | 28.2 | 22.0 | **58 %** |

Per device over 1 h: H10 21.7 vs 10.5 (ratio 2.1, resolved) · Verity 33.8 vs 22.0 (1.5, marginal) ·
O2Ring 2611.7 vs 908.5 (meaningless — drawn axis).

**The estimator's accuracy and the quantity's resolvability are independent questions and only the
first had ever been asked.** §3.3 recovers an injected rate to 0.03 % *because the injection is large
and coherent*; a device's own rate is neither.

## 🔴 WITHDRAWN — "`ECG_AXIS_MIN_SPAN_MS = 2400 s` is an order of magnitude too permissive"

**This brief asserted that, and it is wrong.** Recorded rather than deleted, because it shipped in
this brief, in `changes/2026-08-14-known-clock-corpus.md` and in `papers/known-clock-recovery.html`,
and because the way it was wrong is more useful than the claim was.

The reasoning was: only 6 % of streams in the 300–3600 s band have |ppm| > σ_y, therefore a gate
admitting corrections at 2400 s admits noise. **That conflates two questions.**

| question | test | answer under 1 h |
|---|---|---|
| is the rate **resolved** — quotable as distinguishable from zero? | \|ppm\| vs σ_y | **no** |
| does applying the correction **reduce error**? | \|est − truth\| vs \|0 − truth\| | **yes** |

A span gate governs the second. A point estimate can sit below its own noise floor and still be far
closer to the truth than assuming zero — which is exactly what happens here.

**Measured directly** (truth = the full-span rate, only on streams whose full-span estimate is itself
resolved; the same stream then truncated):

| span | n | med err **corrected** | med err **uncorrected** | correction helped |
|---|---|---|---|---|
| **2400 s** (shipped) | 11 | **8.41 ppm** | 22.27 ppm | **82 %** |
| 4800 s | 11 | 4.71 ppm | 22.27 ppm | **100 %** |
| 9600 s | 9 | 1.93 ppm | 22.19 ppm | **100 %** |

**The gate is doing net good where it stands** — it more than halves the median error at 2400 s. The
18 % harm cases are modest (worst: Verity truth −34.3 ppm, estimate −77.3, error 43.0 vs 34.3
uncorrected). A raise to **4800 s** would remove the harm cases at the cost of refusing correction on
fragments it currently improves; that is defensible, and it is a far smaller claim than the withdrawn
one. **n = 9–11** — truth requires a resolved full-span estimate, so few streams qualify. Do not push
this harder than that n allows.

⚠ `HOSTAXIS-STABILITY` made a claim of this shape and withdrew it as *"marginal, not wrong"*. This
brief re-opened it on stronger evidence and then **independently reproduced the reason it was
withdrawn. The withdrawal was correct.** The σ_y result above is untouched — it licenses a caveat on
**quoting** a ppm, not a change to a gate that governs **applying** one.

### The within-stream span sweep that produced this (162 points, O2Ring + `ppi` excluded as drawn)

| span | n | med \|ppm\| | med σ_y | resolved |
|---|---|---|---|---|
| 300 s | 38 | 134.33 | 1072.93 | 0 % |
| 1200 s | 26 | 59.56 | 203.99 | 0 % |
| **2400 s** | 21 | 32.95 | 86.16 | **5 %** |
| 4800 s | 19 | 24.62 | 43.59 | 16 % |
| 9600 s | 19 | 24.51 | 21.07 | **63 %** |
| 19200 s | 6 | 22.33 | 11.95 | 67 % |

σ_y halves as span doubles, consistent with the measured τ⁻¹ slope. Resolution crosses 50 % between
4800 s and 9600 s (H10 88 % at 9600 s; Verity 45 %, and Verity never reaches it inside this corpus).

## Also confirmed at corpus scale

`deviceDrawn` **exactly partitions the unrecoverable population**: all 16 zero-span streams — the ones
showing 100 % relative error at every injection — are flagged drawn, and no other stream is.

## Incidental: `verify:docs` cannot see a page that was never deployed

Adding `papers/known-clock-recovery.html` left `npm run verify:docs` reporting **"docs/ current — 53
pages"** while `docs/papers/papers.html` already linked to a file that did not exist there — the served
site would have 404'd on its own index link, with the drift gate green.

Cause: `build-docs.mjs` builds its page list as `walk(DEPLOY)` and `DEPLOY` **is** `docs/`. It syncs
pages already present; it cannot discover one that has never been copied. So the check answers "is every
page I already serve up to date" and is read as "is everything that should be served, served" — the same
shape as this repo's other absence-failures. Seeding the twin once fixes it (54 pages, sitemap + feed +
index all carry the paper), but **the gate did not surface it and would not surface the next one.**
Filed here rather than fixed: the fix belongs to whoever owns `build-docs.mjs`, and a wrong guess about
what `docs/` should contain is worse than the gap.

---

# Phase 3 — target 6, beat-matching errors (executed 2026-08-14)

Tool: **`tools/beat-error-recovery.mjs`** (self-tested, seeded, no `Math.random`/`Date.now`).
Substrate: **101 real H10 RR trains**, median 1440 beats, median true rMSSD 44.6 ms.

**Why this target outranks everything in Phase 1–2.** A 30 ppm rate error moves a 7 h night by 0.75 s
and moves rMSSD by ~0.003 %, because rMSSD is a first difference and a smooth rate error cancels.
A single missed beat fuses two intervals into one ~2× normal, and rMSSD is *quadratic* in that. The
two failure families are not the same size and only one of them had ever been measured here.

| injection | RAW rMSSD err | ECG-Malik (0.20) | PPG-Malik (0.30) | ECG beats fixed |
|---|---|---|---|---|
| **miss 0.1 %** | **+20.8 %** | −22.0 % | −18.9 % | 3 |
| miss 0.5 % | +114.4 % | −22.0 % | −19.6 % | 9 |
| miss 2 % | +387.0 % | −22.0 % | −19.4 % | 31 |
| miss 5 % | +614.5 % | −22.2 % | −17.8 % | 73 |
| FP 0.1 % | +23.0 % | −22.0 % | −18.8 % | 8 |
| FP 5 % | +293.2 % | −10.7 % | −4.6 % | 184 |
| jitter 2 ms | +0.1 % | −22.0 % | −18.8 % | 3 |
| jitter 30 ms | +15.3 % | −5.4 % | −3.9 % | 3 |
| **NULL (clean)** | **0.00 %** | **−21.95 %** | **−18.85 %** | 3 |

**One missed beat in a thousand inflates rMSSD by 20.8 %.** Mean RR moves 0.06 % for the same
injection — so a summary HR looks perfect while the HRV metric is a fifth wrong. Detector accuracy
and clock accuracy are not comparable quantities, and the suite had been measuring the smaller one.

**The corrector lands on the same value regardless of what was injected** (−22 % at 0.1 % miss and at
5 % miss alike). It is not converging on truth; it is converging on its own flattened estimate. It
does remove the injected damage — +614 % → −22 % is a real repair — but it arrives at a fixed offset.

**🔴 What this CANNOT distinguish, stated because the tempting conclusion is unsupported.** The
"truth" here is the as-recorded device RR train, which already contains real ectopy and real detector
artefacts. So the NULL row's **−21.95 %** has two readings that this experiment cannot separate:

1. the corrector carries a ~22 % downward bias, or
2. the raw train carries ~22 % of artefact-driven rMSSD inflation that the corrector correctly removes.

**Do not cite this as "Malik is biased."** What it does establish is the *magnitude*: correcting a
median of **3 beats out of 1440** (0.2 %) moves rMSSD by 22 %, because rMSSD is quadratic and its
extremes dominate. The choice of corrector matters as much as a 1-in-1000 detector error rate.
Separating (1) from (2) needs a train with independently-known beat truth — simultaneous ECG with
manually adjudicated R-peaks — which this corpus does not contain.

**Wrong-corrector cost, measured.** The suite applies a stricter Malik bound to ECG/Pulse than to
optical PPG (300/2200/**0.20** vs 300/2000/**0.30**, intentional per `oxydex-dsp.js:92`). An earlier
run of this tool used the PPG corrector on ECG-derived RR — the wrong one. On a synthetic train with
one planted merged beat the ECG corrector recovers rMSSD to **8.1 ms against a truth of 8.1 ms**,
correcting exactly 1 interval. Both legs are now reported side by side so attribution is explicit.

**A third instance of the same tool bug.** This tool read `correctRR`'s return as `rr | corrected |
out`; the shipped shape is `{ nn, tt, nCorr, flags }`. It matched nothing and recorded null for all
101 streams, so the whole first corpus run printed `after Malik: n/a` while the corrector ran fine.
Silence read as a result — the same failure as Phase 2's `stability.ok`. A regression assertion now
requires both corrector legs to be *populated*.

---

# Phase 4 — the capture write path (executed 2026-08-14)

Everything in Phases 1–3 perturbs the *sidecar*, which leaves the capture daemon outside the loop:
decoding a PMD frame, stamping arrival and formatting the CSV all happen **before** the substrate
those experiments touch. `capture-host` holds a 100 % coverage floor and had **no test following a
clock relationship from a wire frame to a recovered rate**.

`capture-host/tests/test_write_path_clock_recovery.py` closes it. A device clock running at a known
offset goes in as raw PMD bytes; the **real** `decode_frame` parses it, the **real**
`PmdArrivalLogWriter` writes it, the file is read back, and the rate is recovered from the written
columns. Nothing is reimplemented — a test that formatted its own CSV would pass while the shipped
formatter was broken, which is the gap being closed.

Planted **0 / +50 / −50 / +200 ppm** over a 40-min synthetic session at 130 Hz; each recovered to
within **2 ppm** at the correct sign (host−device, so a fast device reads negative). Two properties
are pinned separately because the rate test alone does not cover them: the arrival stamp keeps
**millisecond** resolution (a whole-second stamp makes every rate under ~400 ppm unrecoverable while
the 200 ppm case still passes), and a missing device stamp is written **blank, never a fabricated 0**
— §2.6's rule applied to the write path.

**The tests were verified by breaking the code, not by passing.** Truncating `_phone_ts` to whole
seconds kills 3 of 4; making the blank-field helper emit `"0"` kills the fourth. Both mutants were
reverted and `writers.py` is byte-identical. A first-run pass proves nothing here — the repo's own
lesson (`ui-export-paths-broken`) is that a gate is evidence only once you have seen it fail.

⚠ `shellcheck` is **absent on this machine** (exit 127). That is a missing tool, not a failing gate,
and it is called out because `check.sh` prints it beside real failures.

## Still not done

- **A blind operator.** Criteria were preregistered and hashed, but the same agent injected and
  analysed. §3.6b — a claim this brief made and then withdrew — is the live demonstration: it was
  caught only because that same operator ran one more measurement. Handing the analysis to a
  different session is the only real fix.
- **Beat truth.** Phase 3 cannot separate "the corrector is biased" from "the raw train carries
  ~22 % artefact inflation" without independently adjudicated R-peaks, which no corpus here contains.
- **Sensor noise is stream-attributed, not device-attributed.** §3.10 escapes the adapter confound by
  comparing two streams on one device, which is enough to place the noise on the Verity accelerometer
  but not enough to say a *device* is noisier than another.

## Cross-references

- `ALLAN-DEVIATION-2026-08-12-BRIEF.md` — σ_y(τ), the analysis leg for target 3.
- `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md` — `hostAxis`, `independent`, the drawn-axis detector.
- `WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md` — the O2Ring's −2282…+141 ppm swing that turned out not to be a crystal.
- `CLAUDE.md` §7 — the Clock Contract's host-disciplined axis; the span rule targets 1/2 must obey.
- `capture-host/host_clock.py` — `TIMEBASE_MAX_STRATUM`, `timebase_decision()`; §2.1's open question.
