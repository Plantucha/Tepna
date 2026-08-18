---
bump: minor
type: added
---

**The O2Ring does have a clock, and the brief said it didn't.** The device shows the time on its own
screen; the claim it lacks a clock came from reading only its PPG stream, where `sensor timestamp [ns]`
is `0` under a `# timebase=host-disciplined` header. `OXYFRAME` carries **`duration_s`** — a device-side
counter — plus `ppg_n` per frame, and those two timestamp every raw PPG sample on the **ring's own clock**.

`tools/tch-third-corner.mjs` builds that axis and runs the hat with all three corners on genuine device
clocks. The accounting is asserted before any timestamp is emitted: **`sum(ppg_n)` equalled the PPG row
count to the sample** (3 240 245 on 2026-08-17). A reconstruction that merely looked plausible would
mis-timestamp everything after the first dropped frame with nothing downstream to catch it.

## The finding: wiring the third corner does NOT rescue the hat

With all three corners on real device clocks the solve **still returns a negative variance** and still
needs **ρ ≈ 0.77** to close:

    σ H10 2.472 bpm (w 0.063) · Verity 1.631 (0.145) · O2Ring 0.536 (0.791)
    method=correlated  rho=0.77  negativeVariance=true

So `_tchHat`'s `pseudo`/heuristic tier **stands, for a better reason than the one it records**. The limit
was never the timebase — three sensors on one body measuring one heart have **common-mode correlated
errors**, which violates TCH's founding assumption. **Capture-side work to discipline the O2Ring waveform
to `duration_s` would not upgrade the tier**, and that is worth knowing before anyone spends it.

## Three traps, each of which produced a wrong answer first

- ⚠ **Never build the corner from `OXYFRAME.pr`.** It is the ring's own SMOOTHED pulse rate and understates
  σ exactly as the H10's `_HR.txt` does. Measured: σ = **0.168 bpm** and 75 % of the fusion weight — wrong
  in the direction that makes it look authoritative.
- ⚠ **Frames are a PREFIX of the rows, not a bijection.** They stop at the counter reset that ends a
  session while the PPG file keeps its tail (13 678 samples). Requiring equality rejects good nights;
  `sum <= rows` plus a reported trim is the honest form.
- ⚠ **Corner series are plain number arrays.** Passing `{tMin, v}` objects returns
  `insufficient paired overlap` — a generic reason for a shape error, which reads as "not enough data".

## Also corrects a measured claim in CLAUDE.md §7

The O2Ring's error is recorded there as **−3035 ppm decaying to −1622 ppm**, described as non-linear
crystal behaviour. Re-measured against the host: hours 0–3 hold **flat at ~4 s lag (sub-ppm)** and the
degradation begins only after the first BLE dropout, at ~12.5 s/hour. **The ring's crystal is fine; the
link is not.** The "decay" is what accumulating dropouts look like through a single linear fit. Left as a
tool finding here rather than a CLAUDE.md edit — that paragraph governs fleet-wide treatment and the
change is the owner's call.

Gate: `npm run test:tools` — 43 tools, 503+ assertions, all green; this tool contributes 15, including an
anti-vacuity control that healthy frames report **no** stall.
