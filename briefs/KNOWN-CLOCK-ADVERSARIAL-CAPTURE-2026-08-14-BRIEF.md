<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-14 · **Follows:** `ALLAN-DEVIATION-2026-08-12-BRIEF.md`, `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md` · **Affects:** `capture-host/`, `clock.js` §7, `ecgdex-dsp.js`, `ppgdex-dsp.js`, `oxydex-dsp.js`

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

### 2.1 · The host is Stratum **2**, and it fails the suite's own rate-trust gate — but that is not the limiting term

Measured on the box, 2026-08-14:

```
Stratum         : 2                    Skew        : 0.011 ppm
RMS offset      : 0.000019485 s         Root delay  : 0.000422567 s
Reference ID    : C0A8007B (192.168.0.123)   ← itself Stratum 1
sourcestats 192.168.0.123 : offset −47 ns · freq skew 0.010 ppm · std dev 13 µs over 137 m
```

`host_clock.py` sets `TIMEBASE_MAX_STRATUM = 1` — *"must be a genuine reference clock (stratum ≤ 1,
PPS/GPS-backed)"*. The box is stratum 2. **`timebase_decision()` refuses to grant rate-trust today**,
and the proposal's phrase "PPS-disciplined host" is therefore an unmet precondition, not a setting.

But the more useful measurement is the ratio. The host's RMS offset is **19.5 µs**. BLE delivery
jitter into this same pipeline is **~100 ms, with 470 ms observed** (`clock.js` §7). The host is
already **~4 orders of magnitude** tighter than the transport that immediately follows it.

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
feature** — a deliberate marker (a tap artefact, a commanded LED event, a motion impulse visible in
both ACC streams), not on the beat train. If it is defined on beats, the experiment reports pass/fail
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

- [ ] `acceptance.json` is committed **before** the first blind run, with its hash recorded here.
- [ ] ≥1 null night is in the blind set and the pipeline did **not** recover a perturbation from it.
- [ ] All eight targets reported, each with span/anchor count where it quotes a rate.
- [ ] The O2Ring leg **refused** on every clock-recovery target, as predicted in advance.
- [ ] Target 1 is evaluated on an aperiodic marker, not on beat alignment.
- [ ] Adapter assignment is recorded per night and held fixed across the set.
- [ ] The result is written up whether it passes or fails — a failed recovery is the more valuable
      paper, and `papers/dead-ends.html` is where it goes if so.

## Cross-references

- `ALLAN-DEVIATION-2026-08-12-BRIEF.md` — σ_y(τ), the analysis leg for target 3.
- `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md` — `hostAxis`, `independent`, the drawn-axis detector.
- `WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md` — the O2Ring's −2282…+141 ppm swing that turned out not to be a crystal.
- `CLAUDE.md` §7 — the Clock Contract's host-disciplined axis; the span rule targets 1/2 must obey.
- `capture-host/host_clock.py` — `TIMEBASE_MAX_STRATUM`, `timebase_decision()`; §2.1's open question.
