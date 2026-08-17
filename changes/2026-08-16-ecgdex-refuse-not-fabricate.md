---
bump: patch
type: fixed
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---

ECGDex's statistical and spectral paths returned **fabricated zeros** on insufficient input, and those
zeros reached registered, badged metrics where nothing distinguished them from a real measurement of
zero. The Clock Contract §2.6 rule — *"a missing stamp must be visible (null), never fabricated"* — was
honoured by the parser and never inherited by the DSP.

**The sharpest case, and the reason this is not cosmetic.** `hfnu` is `validated` tier. With hf and lf
absent it evaluated

```js
spec.hf / (spec.hf + spec.lf || 1) * 100
```

`null + null` is `0`, `0 || 1` is `1`, `null / 1` is `0` — publishing a clean **0.0 %** for a spectrum
that was never transformed. The `|| 1` was there for a genuinely measured `hf + lf === 0`; it silently
took absence as well.

**Four sites, all reaching `ecgdex-registry.js` metrics:**

| site | was | now | tier of what it feeds |
|---|---|---|---|
| `lombScargle` N < 12 | `{tp:0, vlf:0, lf:0, hf:0, lfhf:0, respRate:0}` | all-null fields | `vlf` **validated**, `hfnu`/`lfnu` **validated**, `lfhf`/`respRate` emerging |
| `poincareGeo` n < 3 | `{sd1:0, sd2:0}` | `{sd1:null, sd2:null}` | `sd1`/`sd2` **validated** |
| `detectCVHR` N < 60 | `{index:0, …}` | `{index:null, …}` | `cvhrIndex` emerging |
| derived | `sd1sd2`, `ellArea`, `hfnu`, `lfnu` | refuse when an input is absent | — |

Null-VALUED FIELDS rather than a null object: callers read `spec.respRate` on the result, so a bare
null would crash them. `events` stays `[]` — "no events found" is honest for a list; it is the INDEX
that has to refuse.

**The consumers were where the fabrication would have re-entered.** `+pg.sd1.toFixed(2)` throws on
null; `+null` is 0. `sd1sd2` used the same `|| 1` shape as `hfnu`, and `null / 1` is 0, so a refusal
would have surfaced as a ratio of exactly 0.000. Both now refuse. `nz()` at the export boundary was
already null-preserving, and `epochs.filter(e => e.resp > 0)` already drops nulls, so neither needed
changing — checked rather than assumed.

**Assertions were SEEN TO FAIL before the fix**, against `origin/main`'s module: 7 red with
`got 0 · want null` (hf, lf, vlf, tp, lfhf, respRate, and the hfnu 0.0 %). `poincareGeo`/`detectCVHR`
were not exported, so their pre-fix zeros were proved separately in a realm with the exports injected
(`{sd1:0, sd2:0}`, `index: 0`); both are now exported so the guards are directly assertable — additive,
no existing caller reaches them that way.

**Blast radius measured on BOTH capture populations, not assumed.**

```
BOX    5 nights analysed   lombScargle  152 calls   REFUSED 0   min N 37
PHONE  6 nights analysed   lombScargle 2154 calls   REFUSED 0   min N 44
```

2306 calls, zero hits below the N<12 guard — consistent with the 4-night box figure (2349 calls,
min N 24) that prompted this. **Latent is not unreachable:** min N 37 is three times the guard, and
`analyze` already throws on a whole-record shortfall, so these guards protect the per-EPOCH calls —
exactly what a fragmented night, a doffing gap or a dropped BLE link shortens.

`DEX_UPLOADS=<corpus> node tests/run-tests.mjs --group=ecgdex` → **1112 assertions, 0 failures**, with
the equivalence legs RUNNING (`Phase-9 compute() ≡ committed export`, `ECGDex rich export ≡ its
committed golden`, the committed FRAGMENTED ECG twin) and **zero corpus-related skips** — so
export-inertness here is gate-confirmed, not claimed.

`computeHash` **moved** (`a9b2b198f69f → f481438843d3`), as a compute-path change must, so the
corpus-backed fixtures were re-verified via `tools/verify-fixtures.mjs` rather than re-stamped around.

**Registry tiers are untouched.** This is a refusal fix, not a re-grading.

**Not in scope, reported instead of silently widened:** `std`/`median`/`quant` return 0 on empty or
<2 input and are used throughout — highest blast radius, and it belongs in its own change.
`accAnalyze`'s `respRate = period ? … : 0` is the same defect class at a fifth site. `analyze`'s
`{acc:null, accFs:null}`, `_seedScale` and the int16 mean are correct as they stand.

PulseDex already had this fix — the suite carries *"PulseDex indices that cannot be computed report
null, not a graded 0 (DA-V §2.6)"*. ECGDex is the node that never inherited it.
