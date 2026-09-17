---
bump: minor
type: fixed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`cohort-harness.html` scores again. It was broken **twice over**, and the second break is the one that
matters.

## Break 1 — the load (known, #2570)

The harness `<script src>`-loaded node DSPs as classic scripts; the ESM migration appended bare
re-exports, so the whole file failed to parse. Fixed at build time: the page now carries plain
`<script src>` tags and is registered in `build-analysis.mjs`, whose `readJs` runs each source through
`DexBuild.classicify`. Nothing is fetched at run time, which is what makes it work under `file://`
where every request primitive is refused (#2572 measured all three).

## Break 2 — the adapters, and it survived fixing break 1

Fixing the load did **not** restore scoring. Every call still returned
`{error: "parseRRInput is not defined"}`, then `artifactClean`, then `std` — a chain of bare globals.

The root cause is recorded in `oxydex-dsp.js` itself:

> *"the bare-global back-compat spray was REMOVED. Every realm is now namespaced … **Nothing consumes
> a bare `OxyDex` helper** or bare `allNights` any more"*

**That claim was false.** `cohort-harness.html`'s `RUN` adapters consumed bare `parseCSV`,
`processNight`, `artifactClean`, `rmssd` and `std`. The same comment names the sanctioned pattern —
`cohort-worker` "pulls parseCSV/processNight from `OxyDex._bare` explicitly" — and the adapters now
follow it.

## Verified by value, not by existence (§3.3)

| | measured | published |
|---|---|---|
| ECG−Pulse bias | **0.018 ms** | −0.02 ms |
| ECG−Pulse r | **1.0** | 0.9999 |
| `patJitterSdMs` | **4.93 ms** | ≈4.0 ms |

All **three** Bland–Altman pairs now compute where one did. `patJitterSdMs` is a real measurement
where it was the fallback `0` that `2026-09-16-patsd-zero-is-a-fallback` records. All three realms
(`oxydex`, `glucodex`, `pulsedex`) boot with zero page errors.

This unblocks `rmssd-equivalence`, one of the two papers the re-cut could not reach.

## Declared

- **Concurrent execution of two nodes in one realm is still untested.** All three DSPs are present in
  every realm now; `2026-09-17-node-realm-collision-claim-unverified` load-tested that and said so.
  The `RUN` adapters dispatch on `NODE`, so one realm still answers for one node — the co-residency is
  not relied upon.
- **End-to-end scoring is verified for `pulsedex` only.** `oxydex` and `glucodex` adapters are
  namespaced identically and their realms boot clean, but no scored output was compared against a
  reference for them.
- The `rmssd-equivalence` re-cut itself is **not** done here, and per the brief's §⛔ it owes the 1.9
  A/B before any delta is attributed to the generator.

Full gate 16/16; browser gates `static:true runtime:true python:true canary:true`.
