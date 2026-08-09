<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-08 · **Follows:** `JS-DSP-MUTATION-FLEET-2026-08-08-BRIEF.md` · **Affects:** `ppgdex-dsp.js`, `tests/dex-tests.js`

# PpgDex has 49 test groups and 34 % coverage — because there is nothing to test but `compute()`

`ppgdex-dsp.js` runs the **second-broadest test tag in the fleet — 49 groups, more than `ecgdex`** —
and kills barely a third of its mutants. `ecgdex` runs 48 and kills 62 %. That is the one result in
the fleet map the usual explanation cannot cover, and this brief reports what it actually is.

It is **not** a neglected function, and it is not a matter of writing more tests in the current style.
It is that the file's largest survivor clusters have **no unit-testable surface** — though not, as §3a
corrects, the file as a whole.

---

## 1 · What was measured

Full sweep, all 1176 mutants, scoped, bail on (2026-08-08):

```
killed 395 / 1162 valid = 34.0 %      survivors 767      invalid 14
```

The 60-mutant sample in the fleet map predicted 33 %; the full population came back 34.0 %. **The
sampling method holds** — worth recording, because the fleet map's other eight rows rest on it.

## 2 · The survivors are a long tail, not a cluster

This is the first thing that distinguishes PpgDex from HRVDex, where the same exercise found 197 of
346 survivors (**57 %**) inside a single function and one golden test killed 47 of them.

| | `hrvdex-dsp.js` | `ppgdex-dsp.js` |
|---|---|---|
| survivors | 346 | **767** |
| functions holding them | — | **84** |
| largest cluster | **197 = 57 %** | 63 = **8 %** |
| top 5 / top 10 | — | 26 % / 40 % |
| functions holding only 1–2 | — | 19 |

A golden characterisation test — the technique that worked on HRVDex — would address 8 % here. It was
not written, because writing it and calling it progress would have been the technique fitting the
*last* problem rather than this one.

## 3 · The cause: the top clusters are unreachable

Every one of the six largest clusters is an **internal closure**, reachable only by running the whole
pipeline:

| survivors | function | defined | exported? |
|---:|---|---|---|
| 63 | `magInterfAtSec` | L2426 | **no** |
| 39 | `ma` (moving average) | L1466 | **no** — an arrow function *inside* `cvhrFromNN`, which is itself unexported |
| 35 | `evt` | L3386 | **no** |
| 34 | `perfWindow` | L2930 | **no** |
| 29 | `c` | L122 | **no** |
| 25 | `ppgLoadOwnExport` | L4034 | **no** |

`ppgdex-dsp.js` is **4099 lines with 78 internal functions**, and its entire public surface is
`compute`, `parsePPG`, `analyze`, `lombScargle`, `loadOwnExport`, `scrubExport`. What the suite
actually calls is narrower still: **`.compute` ×8**, plus `lombScargle` and `loadOwnExport` once each.

So all 49 groups drive `compute()` end to end. A mutation to any single interior comparison — a window
bound, a gating threshold, a moving-average index — usually does not perturb the final export enough
to fail an assertion. **That is exactly what a 34 % rate under a broad tag looks like**, and it is a
property of the surface, not of the diligence of whoever wrote the tests.

**The contrast is the proof, not the theory.** `hrvdex-dsp.js` exposes nine functions on `_bare`,
including `computeDerived` — and one targeted golden over it moved that file **29.4 % → 39.1 %,
47 mutants, in a single group** (#1030). The technique is not in question; the handle is.

## 3a · CORRECTION — half the survivors ARE in top-level functions

The section above is right about the six largest clusters and **wrong if read as a claim about the
whole file**, which the first draft invited. Checking every survivor-holding function rather than the
top six: **396 of 767 survivors (52 %) sit in TOP-LEVEL functions with ordinary signatures.** The six
biggest clusters being closures was a property of the sample, not of the file.

Recorded rather than quietly edited, because the error is instructive: six data points agreed, the
conclusion was plausible, and it was still an over-generalisation. The same shape as every other
mistake in this sequence — see §4 of the fleet brief.

The genuinely exportable, argument-taking candidates:

| survivors | function | signature | note |
|---:|---|---|---|
| 21 | `lombScargle` | `(tt, nn)` | **already exported** — and still 21 survivors, so exporting alone is not sufficient; the suite calls it once |
| 20 | `_ckMk` | `(y, mo0, d, h, mi, se, ms)` | PpgDex's node-local clock builder |
| 19 | `cadenceSamples` | `(bp, fs)` | |
| 18 | `cvhrFromNN` | `(nn, tt)` | apnea-band detector |
| 16 | `detectBeats` | `(bp, fs)` | core beat detection |
| 14 | `parseTimestamp` | `(raw, opts)` | PpgDex's deliberate node-local variant (CLAUDE.md §✅) |
| 13 | `harmonicOutlierRefIdx` | `(refIdx, rates, snr)` | |
| 12 | `validatePPI` | `(selfNN, devicePPI)` | self-vs-device agreement |
| 11 | `timeDomain` | `(nn, cleanMask, omit)` | shipped HRV metrics |

`lombScargle` is the instructive one: it is **already public and still holds 21 survivors**, because
the suite calls it exactly once. Exporting creates the *opportunity* to test; it does not create the
test. Any plan resting on exports alone would repeat that.

`parseTimestamp` + `_ckMk` together hold **34** — that is PpgDex's node-local Clock Contract
implementation, and it is unexercised locally even though `clock.js`'s equivalent is the most
heavily-tested code in the repo.

## 4 · Proposed: give the pure helpers a surface

Additively expose the pure, side-effect-free helpers on a `_bare` object — **the pattern
`hrvdex-dsp.js` already uses**, so this is adopting an in-repo convention rather than inventing one.
Candidates, in value order rather than survivor-count order:

1. **`cvhrFromNN`** (and with it `ma`) — cyclic variation of heart rate, the apnea-band detector.
   Takes `(nn, tt)` and returns `{events, index}`: a pure function of two arrays, trivially
   known-answerable with a synthetic ~30 s oscillation, and clinically load-bearing.
2. **`perfWindow`** — perfusion index, a **shipped metric** that reaches a user's eye.
3. **`evt`** — the `ganglior_events` emitter. A defect here propagates into every consumer of the
   cross-node contract, which makes it the highest-consequence item even at 35 survivors.
4. **`magInterfAtSec`** — magnetometer interference gating; decides which data is trusted.

**This is not free, and the cost is the reason it is a brief and not a commit.** Touching
`ppgdex-dsp.js` moves its `manifestHash` **and** its `computeHash` (a DSP is inside the compute
closure), so it requires a re-bundle and owes fixture re-verification per CLAUDE.md §🔏 —
`DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`. Adding an export is *export-inert* by
inspection, but §🔏 is explicit that export-inertness is **computed, not claimed**: record the
`computeHash` pair, do not write the word.

## 5 · What NOT to do

- **Do not write more end-to-end `compute()` tests to chase this number.** 49 groups already do that
  and reach 34 %. More of the same buys little; the ceiling is set by the surface.
- **Do not export everything.** 78 functions is not an API. Export the pure ones with meaningful
  contracts; a helper that mutates closure state is not made testable by being reachable.
- **Do not treat 34 % as comparable to `clock.js`'s 84 %.** `clock.js` is 414 lines of pure functions
  with an exported parser. The two numbers measure different things, and ranking them as if they were
  one metric is how a testable module gets punished for being large.

## 6 · Also found

**14 invalid mutants — 12 `timeout`, 2 `no-output`** (the reasons are recorded per-mutant since
#1017). The timeouts are the now-familiar `num → 0` shape turning a loop increment or a rounding
constant into zero (`fs = Math.round(fs * 100) / 100`, `HOP = Math.round(fs * 15)`), plus a
`for (…; i < n; i++)` mutated to `<=`. Twelve non-terminating mutants in one file is the highest in
the fleet and is itself a signal about how loop-dense this DSP is.

## 7 · Done when

- [x] Full 1176-mutant sweep run; rate and survivor distribution recorded (§1, §2).
- [x] Cause identified and evidenced against the alternative explanation (§3).
- [ ] `cvhrFromNN` / `perfWindow` / `evt` / `magInterfAtSec` exposed on `_bare`, additively.
- [ ] Known-answer groups written for each, **each verified by re-applying its own mutant** — a test
      written from reading the code has twice today passed under the mutant it was meant to kill.
- [ ] Re-sweep and report the **measured** delta, as #1030 did (29.4 % → 39.1 %). No claimed figure.
- [ ] Re-bundle + `computeHash` pair recorded + fixtures re-verified against the corpus (§4).
- [ ] **Owner call:** is widening a DSP's export surface *for testability* acceptable? It is a real
      API change to a shipped node. The alternative is accepting that PpgDex's interior is measurable
      only end-to-end, and saying so in the fleet map rather than leaving it looking like neglect.
