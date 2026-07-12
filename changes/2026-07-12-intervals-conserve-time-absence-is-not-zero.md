<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex, HRVDex, OxyDex]
brief: DEEP-AUDIT-FOLLOWUPS-2026-07-12-BRIEF.md
---
An interval must conserve time, and an absent reading is not a score of zero — the deep audit's four fail-open layers (§B1–§B4).

**§B1 · An accelerometer could still be analysed as a heart recording.** §2 vetoed the foreign stream at
the *adapter*; underneath, PulseDex still accepted **any** column whose median landed in 300–2000, and the
`usable` gate asked whether the values were beat-*sized* — never whether they behaved like *intervals*.
The H10's gravity rail (~973 mg) is beat-sized on every single row.

The brief prescribed rejecting *near-constant* series, citing the rail's **SDNN 9.5 ms** as impossible.
Measured against the real corpus, that test fails **twice**: the **Verity** rail's SDNN is **69.5 ms**,
sitting *inside* the genuine RR range (24.4–162.7 ms over 19 real recordings) — a variability floor tuned
to catch the H10 would have let the Verity straight through — and a floor high enough for both would risk
rejecting **real pathology**.

What shipped is a **conservation law, not a threshold**: RR intervals are the gaps *between* beats, so they
must **sum to the time they span**. 19/19 genuine recordings conserve time to within 1 % (ratio 1.00–1.01);
the H10 read as RR claims **24.6×** the elapsed time, the Verity **15.6×**. Cut at **2.0** — ~8× clear of
both sides — and it can only fire on the *impossible* side, since dropped beats and paused recordings make
the sum **smaller** than the span, never larger. A gappy file cannot trip it; neither can a flat one
(gated: a pathologically flat RR series, SDNN ≈ 1 ms, still passes). Plus a deterministic first line — a
column whose header *declares* `[mg]`/`[dps]`/`[uV]` is never an interval column, whatever its values do.

**§B3 · A fabricated "0 · ok" stress reading — and a gated decision that was protecting it.** The brief
said none of the `||0` siblings reached a user. Wrong: **`_stress` is rendered as a readiness subscore**, so
a Welltory file with no Stress column displayed **0 → "ok" (green)** — reassuring and invented, exactly
§21's bug class one card over. An existing assertion *required* the `||0`, on the stated grounds that *"the
`_hasSubj` presence gate depends on it"* — **that rationale was false**: `_hasSubj` reads `> 0`, and
`null > 0` is false exactly as `0 > 0` is. Verified: every `_hasSubj`-gated composite is still `NaN`. The
gate never needed the zero; it was merely protecting it. Both assertions were reversed deliberately, with
the reasoning recorded in place. A genuine vendor `0` still reads `0` — absence ≠ zero, in both directions.

**§B2 · `_envToSeed` seeded absence to `0`** — the exact coercion that collapsed §3's n.u. denominator into
HF n.u. = 125,000,000 %. The presence gates made it harmless *only because a real band power is never
exactly 0*: safety resting on a coincidence of physiology. Now `null`.

**§B4 · `spo2HrDecouplingPct`** kept the 0-for-undefined shape §18 removed from its coupling sibling. `0/0`
is undefined, not "a perfectly coupled night" — and it ships in the node-export, where a consumer reading
`0` would take it for a measurement.

Gated by a 14-assert group **verified to red on the original code** (the accelerometer parsed as
`usable = true, nUsable = 4000`), with controls proving each input bites. **Export-inert: no fixture output
moved.**
