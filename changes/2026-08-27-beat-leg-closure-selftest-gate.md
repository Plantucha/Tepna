---
bump: patch
type: added
brief: CLOCK-LEG-SIGN-CONTRADICTION-2026-08-13-BRIEF.md
---

`tools/beat-leg-closure.mjs` shipped an 8-case `--selftest` in #1870 that **nothing invoked** — not a
workflow, not `package.json`, and the file is absent from `readSources`. It was reachable only by a
human typing the flag.

⚠️ **The case that matters most is the refusal control.** #1870's whole point is that leg C must refuse
when the fitted slope would report the offset wander rather than the clock — ~450 ms of wander against
~102 ms of signal on 2026-08-13, which is how two fragments of one night disagreed by 40 ppm. **A gate
never shown to trigger is indistinguishable from no gate**, so a refusal control that nobody runs can
rot green for months — the same defect class as the thing it guards.

Ten assertions now drive `legC` directly from the Node lane (the `land-pr` pattern: it is pure given
two beat arrays — no files, no clock, no network), on seeded planted truth so a failure is a
regression and not a draw:

- a clean night recovers its planted −20 ppm and **ships a bound with the rate**;
- **a true zero is an ANSWER, not a refusal** — the first implementation gated on signal/noise, and
  that ratio degenerates at 0 ppm where any noise exceeds a zero signal, so it refused nights on which
  the clocks agree. Pinned because the degenerate form looks correct and passes every non-zero case;
- **the refusal fires** on 6.3 ppm planted under the 2026-08-13 wander shape, and a refusal carries
  **no `ppm` field at all** — there is no bare-ppm fallback path to fall back onto;
- **the raw-vs-residual trap**, pinned: raw peak-to-peak wander CONTAINS the signal, so a gate written
  against raw refuses every genuinely-drifting clean night. Asserted by requiring the clean night that
  correctly resolves to have raw wander EXCEEDING its signal — which the raw form could not do. That
  one was caught only by planted truth; a corpus run looked plausible.

Node-lane only (an ESM import of a tool), so the browser lane SKIPs.
