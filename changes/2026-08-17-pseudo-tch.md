---
bump: minor
type: fixed
---

**The Integrator's drawn-axis TCH guard has been inert since it shipped. It excluded nobody, on every
night, because it reads a field path no producer writes.**

`_tchHat` filters corners on `timingSource === 'none'` — the rule is right and the comment states it:
*"A LEG WITH NO TIMING IS NOT A CLOCK"*, added after a `timingSource:'none'` PpgDex was spent as a full
corner on 2026-08-08. But the reader chain was

    json.timingSource  ||  json.hostAxis.timingSource  ||  null

and **PpgDex writes it under `quality`.** Verified on a real export: `quality.timingSource ===
'device+host'`, top level **ABSENT**. So all three corners resolved to `null` and the filter removed
none of them, on the entire trio corpus. Both downstream guards — this one and closure's §F3 filter —
were reading a field that was never there.

⚠️ **The test that certifies the guard builds `timingSource` at the TOP LEVEL, a shape nothing emits.**
It passes forever and guards nothing: a test encoding the shape its author assumed rather than the one
the producer writes. The comment's own citation, `ppgdex-dsp.js:3333`, points at `buildEpochs` today —
a line reference that silently drifted is the fingerprint that the assertion was never re-run against
reality. A new case builds the fixture through real ingest with the field under `quality`, and it fails
without the read-path fix.

## Pseudo three-cornered hat — report the number, refuse the tier

Fixing the read path makes the `'none'` guard live. It does **not** cover the commoner case: a corner
that declares **nothing**. OxyDex emits no `quality` block at all, so it resolves `null`, which the
filter deliberately keeps.

**Excluding it is not on the menu.** With only ECGDex/PpgDex/OxyDex, dropping a corner leaves two and
`ws.length < 3` returns not-ok — so the choice is not *clean TCH vs contaminated TCH* but **contaminated
TCH vs no estimate at all**.

So the hat now reports `pseudo`, `axisProvenance` and `pseudoReason`, and the render selects a new
`tch_error_pseudo` evidence entry at **`heuristic`** (beside `tch_error`'s `experimental`), with the
card reading **"Per-sensor error (pseudo-TCH)"**. Same shape as `staging_disagreement` above it: an
inherited tier, not an independent judgement.

**The argument is about instability, not clock-ness — and the earlier wording was wrong.** The O2Ring
*has* a crystal and a disciplined RTC (`capture-host/oxyii.py` `SET_UTC_TIME 0xC0` pushes host wall
clock to it), and it genuinely measures HR. What its **export** lacks is per-sample clock readings: the
axis is an anchor plus a nominal rate. An axis of `index × nominal_rate` has **zero apparent
instability by construction** — it cannot disagree with itself — while its real error reappears as a
*timing* error contributing ≈ `δ·dHR/dt` at each shared epoch. That is a function of the **common**
signal's derivative, so it is correlated with the other corners by construction and largest exactly
where HR moves: TCH's uncorrelated-error premise violated in the one way it cannot absorb.

A corner counts as timed only on a **positive** declaration — `device` or `device+host`. `host` (a drawn
axis) and an absent field both fail, because absence of evidence is not evidence of independence. This
upgrades itself the day OxyDex publishes axis provenance.

⚠️ **Anti-vacuity.** On every existing fixture all three corners read `null`, so `pseudo` could be
hardcoded `true` and every new assertion would still pass. A control builds a triple that declares
`device+host` under `quality` on all three and asserts `pseudo === false` with a null reason.

⚠️ **NOT export-inert.** `computeHash` moved (`3f72e7e03f92 → 8d25918d1783`); Integrator and both
orchestrators re-bundled, `docs/` rebuilt, fixtures re-verified against the real corpus.

## ⚠️ Why this keys on a DECLARED field rather than a computed one

`clock.js hostAxis` already computes the stronger signal — `deviceDrawn` / `drawnShare` /
`drawnReason` (`KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14` DEFECT A, bound 0.67 from 381 sidecars,
0/25 missed, 0/356 FP). A computed fact beats a declaration, and keying on it would be better.

**It does not reach the Integrator.** Measured on real exports: `hostAxis.deviceDrawn` is `undefined`
on ECGDex, PpgDex **and** OxyDex; only PpgDex's `quality.timingSource` survives. `clock.js` computes
`deviceDrawn`, the node reshapes its quality block, and the field is dropped there — **the exact defect
that block's own comment warns about**: *"a node summary that renames fields must forward the ones it
does not rename"*, written after `stability` vanished at the same seam.

**And the root cause is not a dropped field — it is an inverted migration order.** `clock.js` L554-564
prescribed the move in capitals and predicted this exact state: *"`deviceDrawn` is published ADDITIVELY
and does NOT gate `independent` … Consumers must move to `deviceDrawn` deliberately, node by node, with
each node's fixtures re-cut."* The consumers moved; no producer did. `integrator-dsp.js` references
`deviceDrawn` three times while every node references it **zero**.

⚠️ **The clearest symptom sits in this same file.** `arrivalPairOffsets` (L5379, exported L6711) exists
to make that provenance refusal — its comment calls `deviceDrawn !== true` *"the PROVENANCE refusal"*
and argues at length that `independent` and `plausibleCrystal` are not substitutes. **It has no
production caller.** Its only references anywhere are seven in `tests/dex-tests.js`, against objects
those tests construct with the field already set. The most carefully evidenced provenance reasoning in
the file is exercised solely by its own tests: it cannot fail, and it cannot help.

⚠️ **The detector that would have caught that exists — in the other lane.** `capture-host/check.sh`
runs `tools/find_unwired.py` ("public functions referenced only by tests"; `0 unexplained, 10 allowed`
on a current run, each allowance carrying a written reason). `npm run check` has fourteen steps and
none of them asks that question. One lane can see this class and the other cannot, which predicts more
of them on the JS side that nobody has looked for.

So `pseudo` is keyed on the weaker signal because the stronger one is not available at the consumer,
and that is a **workaround, not a design choice**. Forwarding `deviceDrawn` through the node exports is
the real fix and is being taken as its own work-unit (additive only, nothing gated, consumers migrating
deliberately with their own fixture re-cuts); it is out of scope here because it moves three nodes'
export bytes.

**Not addressed here:** `tools/tch-multinight.mjs:178` still hard-codes `LABELS = ['ECGDex','PpgDex',
'OxyDex']`, and two sections of `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01` were VOIDED on 2026-08-03
over this corner. Whether it comes out is the owner's call — every published three-corner σ is
downstream. The tool now at least labels the method and prints per-corner provenance.
