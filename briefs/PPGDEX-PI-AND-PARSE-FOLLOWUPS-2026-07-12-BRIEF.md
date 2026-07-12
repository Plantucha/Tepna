<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-12 · **Follows:** `PPGDEX-PI-AND-PARSE-2026-07-12-BRIEF.md`

# PpgDex PI + parse — follow-ups

What surfaced while executing `PPGDEX-PI-AND-PARSE-2026-07-12-BRIEF` and still needs addressing.

## §1 — the companion-parse win, done back-compat-safely (deferred, NOT dismissed)

`EFFICIENCY-AUDIT-FINDINGS-2026-07-12` finding #3 proposed skipping `parseTimestamp` in
`parseSensorXYZ` when `relNs` is finite — **measured 2.08×** on a real night's companions
(`acc0614.txt` 16.2 MB + `gyro0614.txt` 21.0 MB, ~600k rows: 487 → 234 ms; `parseTimestamp` alone was
27% of that CPU profile). It was **rejected during execution as unsafe**, and the reason is the point of
this follow-up:

> **`pat-feasibility-worker.js:117` reads `r.tMs` on exactly those rows** — `if (r.tMs == null) continue;`
> — and `relNs` is finite on every real Polar file. So nulling `tMs` when `relNs` is finite would make
> `motionEnv` skip **every** row and silently return an all-zero grid. The PAT drift-anchor analysis would
> quietly produce nothing, with no error.

The audit had verified byte-identity of `PPGDSP.analyze()`, but `parseSensorXYZ` has a **second consumer
outside the DSP** that it never checked. (`ppgdex-app.js:100-102` is the other.)

**The shape that would be safe** (CLAUDE.md §🧪: *"add new params LAST + optional"*):
`parseSensorXYZ(text, opts)` with `opts.stamps` defaulting to **true** (so every existing caller,
including `pat-feasibility-worker.js`, is unchanged by construction), and only the call sites that
provably never read `tMs` opting out. **Before opting any caller out, prove it:** `tMs` is read by
`analyzeMotion`'s `relSecOf` **only when `relNs` is NaN**, which is the ns-column-broken file — so an
opt-out silently removes that fallback. A safer variant is to keep the fallback alive by parsing lazily
**per row, on first read of `tMs`** — but a getter per row × 600k rows is likely worse than the parse it
saves, so measure before choosing.

**Do NOT** land this by simply nulling `tMs`. **Done when:** the companion parse is ≥2× on the real
`n0614a` companions, `pat-feasibility.html` still produces a non-degenerate motion envelope on a real
file, and both gates are green.

## §2 — `ppgdex-morph.js` is now formatter-exempt; drop it from the list when it is genuinely reflowed

`biome.json`'s `overrides` gained `ppgdex-morph.js` (formatter off, **linter still on**) because it is a
shipped bundle source that predates Biome and had never been touched by a PR since — reflowing its 471
lines would churn provenance and risk the format-sensitive source-text gates. Per the same rule that
governs its siblings: **drop it from the list the day it is genuinely reformatted on a behavioural
re-bundle.**

## §3 — is there another fractional-index loop in the fleet?

The §C1 bug class is *"a sample loop stepped by a float-derived stride, then used as an array index."*
A grep during execution found `ppgdex-morph.js:141` was the fleet's only float-stepped **sample** loop
(`ecgdex-morph.js` windows in *seconds* with a running integer pointer). That was a grep, **not a proof**
— and the failure mode is silent (`undefined` → `NaN` → `null`, no throw). Worth a deliberate sweep:
every `for (… i += <expr involving fs> …)` where `i` then indexes a typed array. If a general shape
emerges, it is a candidate for a house-invariant lint (`DEV-TOOLCHAIN` Part A) rather than a one-off fix.

## §4 — the PI trend was wrong in a *shipped* app and no gate noticed

The suite had PpgDex morphology coverage, but every synthetic fixture used an **integer `fs`** — which
passes even against the bug. The new regression group fixes this one instance by using a real,
non-integral `fs` (176.26). The generalisable lesson: **synthetic fixtures that round off a real-world
messiness (a non-integer sample rate, an unaligned timestamp, a duplicated row) can only prove the code
works on inputs that never occur.** Worth auditing the other nodes' synthetic generators for the same
tidiness — `genSynthetic`'s `fs` in particular.
