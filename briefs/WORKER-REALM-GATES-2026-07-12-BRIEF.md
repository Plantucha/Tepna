<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-12 · **Created:** 2026-07-12 · **Follows:** `PPGDEX-WORKER-CLOSURE-2026-07-12-BRIEF.md`

# The worker realms are now gated — and the ECGDex >5 MB clock mirror is pinned

Follow-up to the `cadenceSamples` bug. That bug was not bad luck: **nothing in this repo executed a
worker.** The audit that followed drove all ten shipped surfaces in a real browser (**0 uncaught errors**
fleet-wide; PpgDex spawning **18/18** healthy workers) and turned up two structural gaps. Both are now
closed.

## The trap that made this class invisible

`detectChannelsAsync` **falls back to the serial path** on `w.onerror`. So a worker that throws still
returns **correct numbers**. Any check that compares worker output to serial output therefore **passes on a
completely dead pool** — which is exactly how `ReferenceError: cadenceSamples is not defined` shipped and
sat there with every gate green.

This is demonstrated, not argued. Against the pre-fix DSP the new browser rig reports:

```
✕ NO worker threw …                                — Uncaught ReferenceError: cadenceSamples is not defined
✓ worker output ≡ serial output on all 3 channels  ← STILL PASSES
```

A results-only rig would have been green the whole time. **The worker's own error channel is the only thing
that exposes it.**

## §1 — the PPG worker blob now EXECUTES in the gates (headless, CI)

A Worker realm starts **empty**. `new Function` reproduces exactly that in both lanes — the DSP's
module-private functions live inside an IIFE, so they are not globals, and a free reference to one throws
just as it would in the worker. So the blob's source is rebuilt from its deps list and **run**, then diffed
against the module's serial `detectChannel` (at a **non-integer `fs`**, as a real Polar file always has).

This matters because **the static check was not enough, and said so falsely**: it reported
`worker source is CLOSED` while the worker still threw `REFR_CADENCE_FRAC is not defined` — a module
`const` does not travel with `Function.toString()`. Only executing the realm found it. The new group reds
against the pre-fix DSP with **the exact console message that was reported**.

Note that `the worker blob EVALUATES in an empty realm` **passes even on the broken code** — function
declarations hoist, so the error only surfaces at *call* time. That is precisely why this group calls it.

## §2 — a REAL Worker rig in the browser lane (headless floor)

`ppgWorkerPoolGroup()` in `Dex-Test-Suite.html` wraps `window.Worker`, drives `detectChannelsAsync`, and
asserts: a real Worker was **spawned** · **none of them errored** · the output **≡ serial**. It rides the
headless floor rather than `?full` — it is ~10k samples, and the bug it guards only ever appeared in a live
console. Verified **4/4 green, spawned=3**, and **3/4 red against the pre-fix DSP**, on the error-channel
assertion alone.

## §3 — ⚠️ the ECGDex >5 MB path had its own ungated clock

`ecgdex-app.js`'s `WORKER_SRC` inlines a **private timestamp parser (`_ckPF`)** — *"workers can't see page
scope"*. That is a **fourth** `parseTimestamp` implementation. `CLAUDE.md` §🔒 single-sources the parser in
`clock.js` and enumerates exactly **three** deliberate node-local variants (ppgdex · glucodex · cpapdex);
this one **is not among them, and no gate asserted it**.

Why that is the worst possible place for a mirror to hide: `_ckPF` runs **only** when ECG ingest goes
through the worker, which is gated on `totalSize > 5e6 || files.length > 1`. **A drift there would corrupt
timestamps exclusively on large overnight recordings — the actual use case — while every small file, every
fixture and every gate kept parsing correctly through `clock.js`.** Silent, and size-dependent.

**Measured: it agrees with `DexClock` on all 12 vendor formats today** (ISO · zoned `Z` / `±HH:MM` ·
no-zone · no-ms · O2Ring DMY *and* MDY · Welltory DMY *and* MDY · numeric epoch · garbage → null ·
empty → null). Nothing kept it agreeing. It is now pinned to that battery.

## What the audit also established

- **Fleet demo sweep, real browser:** PpgDex · OxyDex · PulseDex · HRVDex · GlucoDex · ECGDex · CPAPDex ·
  Integrator · OverDex · Data Unifier → **0 uncaught errors**.
- **ECGDex's blob worker is closed and works** — exercised with a synthesised **9.7 MB** recording. Its
  demo *and* an 881 KB file both take the **serial** path (the worker only fires above 5 MB), which is why
  it had never been exercised at all.
- **H2 RESOLVED — not a bug.** OverDex / Data Unifier really do lack `PPGMorph`, but the DSP guards the call
  (`if (global.PPGMorph)`), neither app ever references morph, and `ganglior.node-export` does not carry it.
  Deliberate slimming, not a silent gap.

## Gate impact
**Gates only — no runtime file touched, no `manifestHash` moved, no fixture re-recorded, no re-bundle.**
Suite **2172/2172 (140 groups)** headless · browser lane **2255 passed / 144 groups**, worker rig **4/4** ·
GATE A **8/8** · GATE B **23/23** · `build --check` clean · shard-union sound.

## Follow-up
`_ckPF` is still a *mirror* — now pinned, but a mirror. Genuinely single-sourcing it would mean shipping
`clock.js`'s `parseTimestamp` into `WORKER_SRC` via `Function.toString()` — the pattern `ppgdex-dsp.js`
already uses for its own worker — which would **delete** the fourth copy rather than police it. Worth doing
on the next behavioural ECGDex re-bundle; not worth a re-bundle on its own.
