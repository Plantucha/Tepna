---
bump: minor
type: added
---

**`timing_uncertainty` summarises delivery jitter as `IQR/1.349`, which assumes a Gaussian tail. The
corpus has excess kurtosis +1901.**

Measured on the real streams: **+1901 (H10 acc), +1400 (H10 ecg), +124 (Verity ppg)** against 0 for a
normal. At that shape there is no stable variance to summarise — the argument this repo already makes
for preferring ADEV over standard deviation, arriving one layer down.

**MTIE is the standard answer, and this repo already ships its other half.** TDEV (#1255) is an RMS
measure; MTIE is the PEAK counterpart, and **ITU-T G.810 (08/96)** defines both because one number
cannot do both jobs. RMS says how much a signal typically varies; MTIE says how far it got.

    MTIE(tau) = max over all windows of length tau of ( max(x) - min(x) ) inside that window

It assumes **no distribution at all**, which is exactly why it survives a tail that has no worst case.

## What it says about the real corpus

| stream | MTIE @1 s | MTIE @256 s | RMS-style (adev·tau) |
|---|---|---|---|
| H10 ecg | **5757 ms** | 5817 ms | **85 ms** |
| H10 acc | 6175 ms | 6290 ms | 89 ms |
| Verity ppg | 6059 ms | 6170 ms | 124 ms |

**A 68× gap.** The RMS view reports 85 ms while the worst case is nearly six seconds, and a six-second
stall is a real thing that happened. Neither number is wrong; they answer different questions, which is
why G.810 specifies both and why this publishes both.

`flat` is the part that changes what you would do: when the shortest and longest windows agree, one
excursion fills every window — a **single stall**, not drift that accumulates with tau. Validated
against planted cases: a lone spike reads 500/500 (`flat: True`), a random walk grows 3.7 → 44.1
(`flat: False`). The corpus rows above are flat, so those six seconds are one event per stream.

## Known-answer validated before the citation was earned

    ramp slope 3      MTIE(tau) = 3*tau EXACTLY at tau = 1, 4, 16, 64
    planted step 42   -> 42.000
    constant series   -> 0
    fast == naive     identical at 7 taus, including non-powers-of-two
    monotonic         non-decreasing in tau, by construction

The fast form is **Bregni & Maccabruni, "Fast Computation of Maximum Time Interval Error by Binary
Decomposition", IEEE Trans. Instrumentation and Measurement 49(6), Dec 2000** — a sparse table of range
max/min over dyadic blocks, built once in O(N log N), after which each window is two O(1) lookups. The
naive form is O(N·W) and a night is ~30 000 samples; measured 0.04–0.20 s for 20–90 k samples.

## An earlier attempt at the same problem was rejected by the data

Dual-Dirac **RJ/DJ decomposition** — the standard SerDes/telecom jitter model — treats jitter as a BOUNDED
deterministic part plus an unbounded random one, and BLE's 7.5 ms connection interval looks like textbook
bounded DJ. **It does not fit.** The tail fit returned **negative DJ** on most real streams, and the
kurtosis says why: a dual-Dirac is flat-topped (negative excess kurtosis); these are single, violently
heavy-tailed peaks. The 7.5 ms bound is real but negligible beside delays of hundreds of ms.

It was implemented, validated against planted dual-Dirac (RJ within 5 %, DJ conservative), and **not
shipped** — feeding `abs(dj)/sqrt(12)` into the uncertainty budget would have fabricated a bounded term
from a model the data contradicts. MTIE assumes neither and was shipped instead.

⚠️ **MTIE is a PEAK, so one outlier sets it and it never averages away.** That is the point. Do not
compare it against TDEV and call one wrong.

⚠️ **Unlike ADEV/TDEV it is NOT blind to a constant frequency offset** — a steady rate walks the phase
and MTIE reports the walk. The ramp test pins exactly this. On a series carrying a known offset, remove
it first or read the result as "including the rate".

The unreachable-arm convention was followed rather than tested around: a defensive `k >= len(ups)` guard
in the block lookup cannot fire (`w <= n` is enforced, so `k <= len(ups)-1`), and it was removed.
