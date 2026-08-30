<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — re-measure with `tools/findings-ledger.mjs stats`) · **last-verified:** 2026-08-29

# DSP adversary review — the `qwen3.8:27b` re-audition, and why the lane is retired

> **What this is.** The house-rules DSP adversary lens (`dsp-review-qwen.mjs`, adversary mode) was
> re-run against **`qwen3.8:27b`** to re-test the lane under a newer model after the first audition
> failed its band. It reviewed **227 functions** across `clock.js`, `hrvdex-dsp.js`, `oxydex-dsp.js`
> and `pulsedex-dsp.js` and produced **309 findings**.
>
> **Verdict: the lane is RETIRED under 3.8 as well.** Confirmed rate **20.7 %**, below the
> `QWEN-ENGINEERING-PROGRAM` §2.5 band of 30 % after 30 triaged. The model is not the binding
> constraint; the lens is.

---

## The headline

**Six real findings out of twenty-nine triaged — all in `hrvdex-dsp.js`, all minor.** Not one is a
logic bug. Every one is the same shape: **a function that answers when it should decline** — a
formatter that renders garbage as a plausible reading, a score that treats absence as a mid-scale
value, an event that badges noise as `measured`, a boundary that coerces a string into an epoch.

That shape is worth naming because it is the house's own stated rule (*"missing → visible, never
fabricated"*) failing at the edges rather than in the middle. None of them corrupts a computation;
all of them make an absence look like a measurement.

| | count |
|---|---|
| functions reviewed | 227 |
| findings produced | 309 |
| triaged | 29 |
| **confirmed** | **6** |
| rejected | 23 |
| **confirmed rate** | **20.7 %** (6/29) |

⚠️ **The rate was first reported as 24.1 % (7/29) and is corrected here to 20.7 % (6/29).** One
coordinator TRUE was overturned by execution — see *A verdict that execution reversed*, below. The
band decision is unchanged and is now **more** robust: 20.7 % clears the 30 % bar by a wider margin
than 24.1 % did, so the retirement never hung on the errant judgment.

---

## The six confirmed findings

All six are **execution-backed**: each was re-run against the real module (`clock.js` co-loaded
first, functions reached via `HRVDex._bare`) and the note in the ledger records the actual input and
output, not a summary of them. Ledger ids are the durable handle.

| id | function | executed input → output |
|---|---|---|
| `504125131119` | `fmtClock` | `fmtClock(NaN)` → `"NaN:NaN"` |
| `178e3a92108a` | `fmtDate` | `fmtDate(NaN)` → `"NaN-NaN-NaN"` |
| `34cb6e13c1ca` | `_persistNote` | `{ok:false,failed:false}` → `"… capped to the most recent undefined of undefined …"` |
| `896c2c3a58e1` | `computeCAMQ` | `{_rmssd:0,_pnn50:null,_hf:0}` → `50` |
| `c40d82f8a114` | `hrvEventsFromRows` | `{_tMs:1000,_rmssd:1e-300}` → `conf 0.9`, `evidence:"measured"` |
| `0b85d2096d38` | `_rowFromSeed` | `{tMs:"123"}` → `_tMs: 123` (a **number**) |

**Notes on individual findings.**

- **`178e3a92108a` — the recorded scenario was wrong about the output, and the finding survives it.**
  The scenario claimed `new Date(NaN)` "evaluates to the current system time", which would be the
  more dangerous defect. It does not: `getUTC*` off an Invalid Date yields `NaN`, so the real output
  is `"NaN-NaN-NaN"`. A date-shaped string built from nothing is still a fabrication; only its
  disguise is worse in the claim than in reality.
- **`c40d82f8a114`** is the one with a downstream consumer: a `1e-300` RMSSD is emitted as an
  `hrv_low` impulse at confidence 0.9 with `evidence: "measured"`, so a noise-level value enters the
  event stream wearing the highest evidence tier the node can assign.
- **`0b85d2096d38`** sits at the **storage boundary** — `_rowFromSeed` reads back what
  `_seedFromRow` wrote, so the coercion turns a corrupted mirror into a valid-looking row rather
  than a rejected one.

---

## A verdict that execution reversed — and why it belongs in this document

**`9ba70051dbfb` (`persistHRVRows`) was judged TRUE by the coordinator and is REJECTED here.** It is
recorded rather than quietly dropped, because a coordinator verdict overturned by execution is
exactly what the precision metric exists to surface.

The recorded claim was that the quota-pressure halving loop can let `kept` become empty and persist
an empty mirror. It cannot: the loop is `while (kept.length > 1)` and each step is
`slice(-Math.max(1, Math.floor(len / 2)))`, so `kept` never reaches zero. Executed with
`allRows.length = 8`:

- every `setItem` throwing → **`{failed:true}`**, nothing stored;
- a realistic size-capped quota → **`{failed:true}`**;
- the separate no-rows branch → `removeItem(HRV_STORE_KEY)` then `{ok:true}`, and the key is
  verifiably gone.

**The discriminator that was skipped: is the empty end-state the CORRECT one?** No rows means no
mirror, so `{ok:true}` is an honest report of "nothing to store", and `{failed:true}` under quota is
precisely the refusal the claim says is missing. **An honest no-op is indistinguishable from a
fabrication until you ask whether the emptiness is right** — which makes this the *inverse* of the
house's examined-nothing class: a correct report over-flagged as a fabricated one.

⚠️ **The first attempt to verify it was itself vacuous, and would have filed a false confirm.**
`compute({rows})` silently failed to populate `allRows`, so the quota case fell through the
*no-rows* branch and returned `{ok:true}` — visually identical to the claim reproducing. The tell
was that two cases exercising *different* code paths returned *identical* results. Printing
`allRows.length` as an asserted precondition separated them. **Identical output from paths that
should differ is the signal to trust.**

---

## ⚠️ Read the rate with its population, or you will quote the wrong one

Three denominators are live at once, and they answer different questions. The ledger's own `stats`
figure is **not** the number in the headline:

| figure | population | recorded on disk? |
|---|---|---|
| **20.7 %** (6/29) | the coordinator's triaged sample of the 3.8 run | **partly** — 21 of the 23 FALSE verdicts are not statused |
| 75 % (6/8) | what is statused in the ledger *from the 3.8 run* | yes |
| **0.16** (6/38) | what `findings-ledger.mjs stats` reports for the lens | yes — but it **spans two model generations** |

The 3.8 population is **308** findings (6 confirmed · 2 rejected · **300 untriaged**); all 30 of the
other rejections belong to the earlier, pre-3.8 run. So the tool's per-lens precision currently
mixes two models into one ratio.

🔴 **This is a real limitation of the metric, not of this review.** `QWEN-ENGINEERING-PROGRAM` §C1
computes precision per **lens**, and a lens that is re-auditioned under a new model has two
populations under one key. A band decision taken on the blended figure would be measuring the wrong
thing. **Precision should be keyed on `(lens, model)`** — the finding records already carry the
`model` stamp, so the data is there and only the aggregation is missing.

---

## What is NOT here

- **The 300 untriaged 3.8 findings.** They are in the ledger, model-stamped, and available; nothing
  in this document licenses treating them as either confirmed or rejected. Untriaged is not clean.
- **A fix for any of the six.** They are recorded, not remediated. Each is small and independently
  actionable; none was fixed in the same unit that judged it.
- **`allanFromPhase([0,1,2,3,4,5], 1) → []`**, raised alongside these and **settled as correct**.
  Six phase points give five differences, and the shortest τ yields `cnt = 4`, which trips
  `if (cnt < 8) break` — *"an estimate from a handful of terms is wider than the answer it gives"*.
  Measured threshold: **10 phase points** returns one τ; 64 returns five. It cannot arise in the
  shipped path at all, because both production callers gate on `ALLAN_MIN_PAIRS = 64` first
  (`ppgdex-dsp.js:3123`, `:3147`). Non-finite input also correctly returns `[]`. **The guard doing
  its job, not an edge defect** — recorded so nobody re-derives it.
- **The CodeQL / workflow-permissions alerts**, which are a separate hardening decision.

---

## Reproducing this

```sh
node tools/findings-ledger.mjs stats                 # per-lens counts + precision
node tools/findings-ledger.mjs open                  # untriaged, oldest first
node tools/findings-ledger.mjs status <id> <verdict> [note]
```

Journals: `.git/tepna-mutation/dsp-review/{clock.js,hrvdex-dsp.js,oxydex-dsp.js,pulsedex-dsp.js}.adversary-38.jsonl`.
Ledger: `.git/tepna-mutation/findings/ledger.jsonl` — **untracked by design** (it lives under
`.git/`), which is why this committed document exists at all: it is the half of the record that
survives the working copy.
