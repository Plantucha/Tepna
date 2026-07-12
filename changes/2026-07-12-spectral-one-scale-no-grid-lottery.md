<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex, PpgDex]
brief: DEEP-AUDIT-2026-07-11-BRIEF.md
---
Report the frequency spectrum on ONE time scale and stop hanging the band split on an arbitrary bin count — the Task-Force identity was broken by 11% and LF/HF swung 44% on a constant nobody was meant to notice.

**§10 — two time scales in one block.** ECGDex built `hf`/`lf` from the **5-minute epoch medians**, then
**overwrote** `tp` and `vlf` with a **whole-night** Lomb–Scargle. Four numbers shipped side by side in one
`hrv.frequency` block on two different scales: on a real 7.26 h night `vlf+lf+hf = 5060 ms²` while
`totalPower = 5674 ms²` — the Task-Force identity broken by **11 %** — and two irreconcilable "HF n.u."
fell out of the same export (ECGDex-native 32.1 vs the HRVDex ingest's 20.4). PpgDex shipped its
**whole-record** values while *already computing* the scale-matched epoch medians (`lfRobust`/`hfRobust`/
`lfhfRobust`), which also inflated the Integrator's cross-node HRV divergence with a pure definition
mismatch.

**§11 — the band split was a grid lottery.** The whole-record transform integrates the periodogram on a
**fixed bin count regardless of record length**. A night's intrinsic resolution is `1/T ≈ 3.8e-5 Hz` — some
50× finer than the grid — so the Riemann sum samples a spiky spectrum at essentially arbitrary points.
Changing **only** the bin count swung LF/HF from **1.747** (nf=219) to **2.265** (nf=220, the shipped
value) to **2.51** (nf=221), and it does **not** converge. Parseval pins the *total* to the variance, which
is exactly why nobody noticed: it is the **split** that floats.

**Both die together.** Frequency-domain HRV is *defined* on 5-minute segments (Task Force 1996); for a long
recording you report the per-segment spectrum. At the 5-min scale the grid is adequate **by construction**
(`df = 0.0025 Hz` is finer than the epoch's own `1/300 s = 0.0033 Hz` resolution), so the lottery cannot
arise, and every band comes from the same transform on the same window. `totalPower` is now **defined** as
the sum of the reported bands, so `vlf + lf + hf == totalPower` holds **exactly** — including inside
`lombScargle` itself, where `tp` was previously rounded independently of the bands.

Both nodes now emit all four bands plus a `window` field naming the scale (`epochMedian5min` /
`wholeRecord` / `representative5min`), so a consumer can refuse to compare an epoch median against a
whole-record value. PpgDex keeps its whole-record numbers under explicit `wholeRecord*` keys — labelled,
not silently mixed in. Emitting `vlf`/`totalPower` also closes the upstream half of §3: HRVDex derives
normalized units as `hf/(totalPower − vlf)`, and an export carrying `lf`/`hf` but no `totalPower` was what
collapsed its denominator to an epsilon.

Export-inert on the equiv path (the `hrv` block is gated behind `opts.rich`): **no fixture output moved**.
