<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-20 · **Follows:** `PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md` (DONE 2026-07-20)

# PpgDex O2Ring finger-site — follow-ups

Everything the parent brief set out is done and, as of 2026-07-20, the §6 round-trip is verified on
real hardware (`docs/O2RING-FINGER-ROUNDTRIP-2026-07-20.md`). What surfaced during execution:

## 1 · One belt-and-suspenders run: `site='finger'` end-to-end on a real POST-#276 capture

The real-hardware round-trip that closed §6 used a session captured **before PR #276**, so the file
is the replicated 3-column shape and `parsePPG` tags it `site='wrist'`. The degenerate-channel
guard collapses it to the honest single-channel path (`ledSingleChannel=true`, `ledAgreementPct=null`),
so the HR/feet/morphology results are exactly what the finger path produces — the round-trip is
genuinely closed. The ONE thing not yet seen on real data is a genuine 1-column file tagging
`site='finger'` **directly**, without the guard.

That path is proven byte-for-byte on the committed synthetic twin (48 gated assertions), and PR #276
makes capture write the 1-column `ppg1` file. So this is not a correctness gap — it is a single
confirmation run:

- **Do:** capture one fresh finger session on current `main` (post-#276), then
  `node tools/o2ring-finger-roundtrip.mjs <ppg1.txt> <ecg.txt> <spo2.csv>`.
- **Expect:** identical acceptance PASS, but now with `site='finger'` and `channels=1` reported
  (not `wrist`/`3`). The DSP math is unchanged — the guard already makes the two file shapes
  numerically identical — so a divergence here would itself be the finding.
- **Done when:** the round-trip doc gains a second row showing `site='finger'` on a real 1-column
  capture, or this item is closed with a note that the synthetic-twin proof + the replicated-capture
  round-trip are together sufficient.

## 2 · Sentinel prevalence on real captures (informational)

The `156` `PPG_INVALID` sentinel handling (§2.4) is gated on the synthetic twin, which plants a
known count. Worth recording the rejected-vs-kept split (`sentinelRejected` / `sentinelKept`) that
`parsePPG` reports across a handful of real nights, to confirm the ~93 %/7 % ratio the brief measured
on the 90 s probe holds at scale. Read-only; no code change unless the ratio is wildly off.
