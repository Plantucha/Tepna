<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-14 (§3/§4 EXECUTED 2026-07-14 · §1 CLOSED 2026-08-01 as NOT ACTIONABLE · **§2's trigger fired 2026-07-15 and the stamp was simply never flipped** — see §2a. Nothing surfaced during this closing pass that warrants a follow-up brief: §1 and §4 each already carry their forward rule inline, and §2's list no longer exists to re-home a rule into) · **Created:** 2026-07-12 · **Follows:** `PPGDEX-PI-AND-PARSE-2026-07-12-BRIEF.md`

# PpgDex PI + parse — follow-ups

What surfaced while executing `PPGDEX-PI-AND-PARSE-2026-07-12-BRIEF` and still needs addressing.

> **Progress (2026-07-14):** **§3 EXECUTED** (the fractional-index bug-class sweep — proven clean
> fleet-wide, no lint) and **§4 EXECUTED** (the synthetic-generator `fs`-tidiness audit — de-tidy
> deliberately not taken, forward rule recorded); both write-ups are inline below. Header stays
> `PROPOSED` because **§1 remains BLOCKED here** (the companion-parse win needs the gitignored ~600k-row
> `n0614a` companions + the browser `pat-feasibility.html` to prove non-degeneracy) and **§2 is
> conditional** (drop `ppgdex-morph.js` from `biome.json`'s formatter-override list only when a behavioural
> re-bundle genuinely reflows it — no trigger yet).

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

---

### §1 CLOSED 2026-08-01 — **NOT ACTIONABLE.** There is no consumer that can opt out.

The safe shape this section specifies was implemented and measured, then **reverted unshipped**. Three
findings, and the third is the one that closes it.

**1 · The win is 1.78×, not 2.08×.** Measured on a real 79.7 MB Polar Verity companion
(`Polar_VeritySense_0C301E3F_20260727221400_GYRO.txt`, 1,165,946 rows) — a different night from the
brief's `n0614a`, which is no longer on disk, so this is a re-measurement rather than a reproduction:

| | ms | rows with `tMs` |
|---|---|---|
| default (`stamps` on) | 1954 | 1,165,946 |
| `{ stamps: false }` | **1096** | 0 |

**1.78×**, below this section's own ≥2× acceptance bar. Recorded as measured rather than rounded up to
the bar it was supposed to clear.

**2 · The consumer census was out of date — 2 had become 9.** This section names
`pat-feasibility-worker.js` and `ppgdex-app.js`. There are now also `resp-acc-analysis-app.js`,
`motiondex-dsp.js`, `tools/trio-batch.mjs`, and `adapters/polar-sense-ppg.js`. That growth is exactly the
hazard the section was written about: *"`parseSensorXYZ` has a second consumer outside the DSP that it
never checked"* — since then it gained four more, and nothing announced them.

**3 · Every one of them reads `tMs`, so the opt-out has nowhere to go.**

| caller | reads |
|---|---|
| `pat-feasibility-worker.js` | `if (r.tMs == null) continue;` — this section's original finding |
| `resp-acc-analysis-app.js:121` | `rows[0].tMs`, and `s.tMs` per sample |
| `motiondex-dsp.js:250,260` | `rows[i].tMs` for its stream anchor and `relSecOf` |
| **`tools/trio-batch.mjs:1299`** | `if (r.tMs != null && isFinite(r.tMs))` — **and it sets `relNs: NaN` on every row it keeps**, making `tMs` the *sole* time base |

`trio-batch` is decisive: it does not merely read `tMs` as a fallback, it discards `relNs` and sorts on
`tMs`. Opting it out drops **every** row — the same silent all-zero failure this section already caught
one consumer over, which is a fair sign the hazard is structural rather than a one-off oversight.

**Why nothing shipped.** The `opts.stamps` parameter is safe and correct (default `true`, and rows with
non-finite `relNs` keep their stamp even under `stamps:false`, so the ns-column-broken fallback survives).
But shipping it means a `ppgdex-dsp.js` change → PpgDex + both orchestrators re-bundled → `computeHash`
moves → fixture re-verification owed, **for a knob no caller can pass**. A dormant optimization is not
free: it is a permanent invitation to opt a caller out later without redoing this audit, and the failure
mode is silence. Re-open only with a NEW consumer that provably never reads `tMs` — and re-run the census
first, because it has already doubled twice.

## §2 — `ppgdex-morph.js` is now formatter-exempt; drop it from the list when it is genuinely reflowed

`biome.json`'s `overrides` gained `ppgdex-morph.js` (formatter off, **linter still on**) because it is a
shipped bundle source that predates Biome and had never been touched by a PR since — reflowing its 471
lines would churn provenance and risk the format-sensitive source-text gates. Per the same rule that
governs its siblings: **drop it from the list the day it is genuinely reformatted on a behavioural
re-bundle.**

### §2a CLOSED 2026-08-14 — the trigger fired 2026-07-15, one day after this brief was deferred for lack of one

The header was written on 2026-07-15 and said *"no trigger yet"*. On that same day
**`02d335d5` — "refactor(suite): P4 — reflow whole tree with Biome, retire formatter-override list"** —
did more than fire the trigger: it reflowed `ppgdex-morph.js` along with the whole tree and **retired the
override list itself**. `biome.json` today has **no `overrides` key at all**, so there is no list to drop
`ppgdex-morph.js` from. The section's request is satisfied in the strongest available sense — not by
exempting the file, but by removing the exemption mechanism.

**Nothing was owed in the code; what was owed was the stamp.** The condition was met the day it was
written down, and the brief then sat `PROPOSED` for a month describing a `biome.json` state that had
already ceased to exist — while its own header cited that condition as one of the two reasons it could
not close. That is the failure mode a *conditional* section invites: an item phrased as "do X the day Y
happens" has no owner watching for Y, so it can silently outlive its own premise.

**Forward rule:** when a section's completion depends on someone else's future commit, name the class of
commit that would satisfy it (here, any fleet-wide reflow) so a later reader can *test* the condition in
one `git log`, and re-check it at every status pass. Do not leave an unwatched conditional as the only
thing holding a brief open.

## §3 — is there another fractional-index loop in the fleet?

The §C1 bug class is *"a sample loop stepped by a float-derived stride, then used as an array index."*
A grep during execution found `ppgdex-morph.js:141` was the fleet's only float-stepped **sample** loop
(`ecgdex-morph.js` windows in *seconds* with a running integer pointer). That was a grep, **not a proof**
— and the failure mode is silent (`undefined` → `NaN` → `null`, no throw). Worth a deliberate sweep:
every `for (… i += <expr involving fs> …)` where `i` then indexes a typed array. If a general shape
emerges, it is a candidate for a house-invariant lint (`DEV-TOOLCHAIN` Part A) rather than a one-off fix.

> **§3 EXECUTED 2026-07-14 — the deliberate sweep is done; the class is PROVEN clean.** Every
> float-/non-integer-strided loop candidate across the whole runtime tree (`*-dsp.js` · `*-morph.js` ·
> `*-cross.js` · `*-app.js` · `*-render.js` · `*-fusion.js` · `signal-*.js` · `dex-*.js` ·
> `sensor-trio-*.js` · `adapters/*` · the workers) was read to its body and classified
> REAL / SAFE / N/A — a coverage table, not another grep. **Result: `ppgdex-morph.js:141` is the SOLE
> member of the class, and it is fixed** (bounds `Math.round(w0)` at :158 before any `raw[]/bp[]` read;
> the float stays only for peak-time math). Everything else is one of: a **time** accumulator whose array
> is indexed by a separate integer pointer (`ecgdex-dsp.js:672`, `ecgdex-morph.js:207`,
> `pulsedex-dsp.js:819`, `ppgdex-dsp.js:806`), an **integer-rounded** stride (`Math.round(30*FS)` &c. —
> `ecgdex-dsp.js:841/863/1504`, `ppgdex-dsp.js:236`, `cpapdex-dsp.js:124`, all decimation
> `Math.max(1,Math.floor(…))` strides), an **integer constant** window (all the OxyDex 1 Hz `WIN/W5/W10`
> loops), or a value that is never an array subscript (a frequency into `sin`, a gridline coordinate, a ρ
> into the TCH solver). **Decision — NO house-invariant lint.** The shape is not general (one instance in
> the fleet's history), and a reliable detector needs the exact loop-body semantic analysis the sweep did
> by hand (does the counter, unrounded, reach an `arr[…]`?); a regex lint would false-positive on the
> ~40 SAFE `Math.round(stride)`/integer-pointer loops above and rot into noise. The one site is pinned
> behaviourally by the `fs=176.26` regression (`dex-tests.js` group *"PpgDex per-window PI — non-integer
> fs"*), which asserts EVERY window carries a finite physiologic PI — the exact failure mode. That
> regression IS the standing guard; the sweep is the proof the guard needs to cover only one place.

## §4 — the PI trend was wrong in a *shipped* app and no gate noticed

The suite had PpgDex morphology coverage, but every synthetic fixture used an **integer `fs`** — which
passes even against the bug. The new regression group fixes this one instance by using a real,
non-integral `fs` (176.26). The generalisable lesson: **synthetic fixtures that round off a real-world
messiness (a non-integer sample rate, an unaligned timestamp, a duplicated row) can only prove the code
works on inputs that never occur.** Worth auditing the other nodes' synthetic generators for the same
tidiness — `genSynthetic`'s `fs` in particular.

> **§4 EXECUTED 2026-07-14 — the generator audit is done; the de-tidy is deliberately NOT taken (with a
> forward rule).** Every synthetic sample-rate in the fleet is an integer: the **committed-fixture**
> generator `tools/make-synthetic-inputs.mjs` writes PpgDex `FS=135` (:263) and ECGDex `FS=130` (:287);
> the **runtime** demo generator `synth-gen.js` writes `renderPPG` `fs=176` (:485), `renderXYZ` `fs=52`
> (:580), `renderWalkACC` `fs=26` (:730); the cohort/OxyDex/GlucoDex streams are `1 Hz`. `genSynthetic`
> (the Integrator's patient generator) emits `ganglior.node-export` **summaries**, not raw waveforms, so
> it has no sample-index path at all. Cross-referenced with the §3 sweep, **only one of these integer
> rates ever masked a real code path**: PpgDex `perWindowMorph`, the fleet's sole fractional-sample-index
> loop. And that path is **already gated** by the dedicated `fs=176.26` regression (`dex-tests.js` group
> *"PpgDex per-window PI — non-integer fs"*), which drives `perWindowMorph` directly with a non-integral
> `fs` and asserts every window yields a finite physiologic PI.
>
> **Why the committed fixture is NOT de-tidied to a non-integral `FS`:** it would be Node-feasible
> (`PpgDex.compute` + `ppgBuildNodeExport` are headless, so `synthetic_ppgdex_golden.node-export.json`
> could be regenerated + GATE-B re-recorded), but the §3 sweep PROVES the whole PpgDex compute pipeline
> has no fractional-index loop other than the already-gated `perWindowMorph`. So de-tidying the fixture
> would exercise the **same** covered path — **redundant coverage bought with real provenance churn** (a
> fixture regen + GATE-B re-record + a changeset). Not worth it. **Forward rule (the durable lesson):**
> when a node gains a **new** sample-windowed computation, cover it with a dedicated **non-integral-`fs`**
> regression (the `fs=176.26` pattern) — do NOT rely on the committed equiv fixture, whose `FS` is
> integral by construction and would pass even against the bug.
