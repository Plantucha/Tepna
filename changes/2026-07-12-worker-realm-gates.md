<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [ppgdex, ecgdex, tests]
brief: WORKER-REALM-GATES-2026-07-12-BRIEF.md
---
Gate the worker realms — and pin the ECGDex >5 MB path's private clock, which nothing was checking.

Follow-up to the `cadenceSamples` bug. It was not bad luck: **nothing in this repo executed a worker.**

**The trap that made the whole class invisible:** `detectChannelsAsync` falls back to serial on
`w.onerror`, so a throwing worker still returns *correct numbers*. Any check comparing worker output to
serial output therefore **passes on a completely dead pool**. Demonstrated, not argued — against the
pre-fix DSP the new browser rig reports `✕ NO worker threw — Uncaught ReferenceError: cadenceSamples is
not defined` while `✓ worker output ≡ serial output on all 3 channels` **still passes**. Only the worker's
own error channel exposes it.

- **§1 — the PPG blob now EXECUTES in the headless gates (CI).** A Worker realm starts empty, and
  `new Function` reproduces that in both lanes (the DSP's module-private functions live in an IIFE, so a
  free reference throws exactly as it would in the worker). The blob is rebuilt from its deps list, **run**,
  and diffed against serial `detectChannel` at a non-integer `fs`. This is necessary because the *static*
  check reported `CLOSED` on code that still threw `REFR_CADENCE_FRAC is not defined` — a module `const`
  does not travel with `Function.toString()`. The new group reds against the pre-fix DSP with the exact
  console message that was reported. (`EVALUATES in an empty realm` passes even on the broken code —
  function declarations hoist, so the error only surfaces at *call* time. That is why the group calls it.)
- **§2 — a REAL Worker rig in the browser lane** (headless floor): wraps `window.Worker`, drives
  `detectChannelsAsync`, and asserts a worker was **spawned** · **none errored** · output **≡ serial**.
  4/4 green; 3/4 red against the pre-fix DSP, on the error-channel assertion alone.
- **§3 — ⚠️ the ECGDex >5 MB path had its own ungated clock.** `WORKER_SRC` inlines a private
  `parseTimestamp` (`_ckPF`) — a **fourth** implementation. `CLAUDE.md` §🔒 enumerates exactly three
  deliberate node-local variants (ppgdex/glucodex/cpapdex); this one was not among them and **no gate
  asserted it**. It runs *only* above the 5 MB worker threshold, so a drift would corrupt timestamps
  **exclusively on large overnight recordings** — the actual use case — while every small file, fixture and
  gate stayed green. Measured: it agrees with `DexClock` on all 12 vendor formats today, and is now pinned
  to that battery.

Also established by the audit: a real-browser sweep of all 10 shipped surfaces → **0 uncaught errors**;
ECGDex's blob worker is closed and works (it needed a synthesised 9.7 MB file to reach — its demo and an
881 KB file both take the serial path); and the OverDex/Data-Unifier missing-`PPGMorph` hypothesis is
**resolved as a non-issue** (guarded, never surfaced, not in the export contract).

Gates only — no runtime file touched, no `manifestHash` moved, no fixture re-recorded, no re-bundle.
