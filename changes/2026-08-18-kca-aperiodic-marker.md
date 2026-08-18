---
bump: patch
type: changed
---

**`KNOWN-CLOCK-ADVERSARIAL-CAPTURE` target 1 stays open — but the marker requirement is now measured
instead of assumed**, so the next capture attempt does not repeat the two that failed.

Two owner-run tap sessions were attempted as the aperiodic marker. **Both are unusable, and not for any of
the reasons you would guess** — not force, not timing precision, not sensor sensitivity. The taps were
**rhythmic**, and a periodic marker pins an offset only *modulo its own period* — the identical failure as
beat alignment mod one RR, which is the failure this box exists to escape.

Cross-correlating the two accelerometer traces on their own device axes over ±6 s:

    lag -0.805 s  100.0%   <- "best"
    lag -1.065 s   84.8%
    lag -0.550 s   75.4%
    lag -1.315 s   74.8%
    peak/median = 2.26x    50%-of-peak band spans the FULL +/-6 s

Those competing peaks sit **0.26 s apart — exactly the tap interval**. `-0.805 s` is not a measurement; it
is one of ~25 equally admissible answers.

**What an admissible marker needs, each term measured:**

- **aperiodic** — deliberately unequal gaps (1 s, 4 s, 2 s, 6 s …); 6–8 events suffice once spacing varies.
- **rigidly coupled** — both devices on one hard surface, tapping the *surface*. Worn on the body the H10
  saw a tap at **SNR 110×** while the Verity saw **9 mg against a 3.8 mg floor (SNR 2.3×)** — no detection.
- **quiet either side** — handling the devices raised noise floors to **135 mg / 427 mg** (SNR 7.4× / 3.6×)
  against **10 mg** untouched. The hand is the noise, not the sensor.

Ceiling is one sample at the measured 51.8 Hz ⇒ **~±19 ms**, versus ~0.2 s from the host route on
box-captured nights — ~10× better, so the marker is worth capturing properly.

## Also corrects the Defect-A wording

The `[✗]` entry described the O2Ring as *"a device with no oscillator"*. **It has one, and displays the
time.** `OXYFRAME.duration_s` is a device-side counter measuring **sub-ppm against the host for the first
~3 h**, degrading only after the first BLE dropout. Defect A is still real and the refusal still owed — but
because the *PPG stream* is host-disciplined (`sensor timestamp [ns] = 0`), not because the hardware lacks
a clock. Same correction as CLAUDE.md §7 in #1460.

Target 1 remains **unticked**: specifying the marker is not evaluating it. Gate: docs-ledger, release-ledger.
