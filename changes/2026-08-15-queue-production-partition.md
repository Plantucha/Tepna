---
bump: patch
type: added
brief: MUTATION-COVERAGE-SELECTION-2026-08-14-BRIEF.md
---

The mutation queue ranks by survivor COUNT, and the tool's own header says count measures SIZE, not
value. Measured on the current fleet, **two of the top four entries were not production code**:

    157  ecgdex-dsp.js    genSynthetic      seeded synthetic-ECG generator
    100  cpapdex-dsp.js   selfTest          the DSP's own self-check
     34  glucodex-dsp.js  genSynthetic      seeded synthetic-CGM generator
     21  motiondex-dsp.js genSyntheticACC   seeded synthetic accelerometer

312 survivors, 6.3 % of the outstanding work, sitting at the top of the list. Killing them asserts
something about a FIXTURE GENERATOR or a self-check, not about analysis a user sees — so the ranked
list was sending the next session to write tests for a random-number generator. #1196 measured this
population fleet-wide at 15.4 %; this is the same finding, made actionable.

`tools/mutation-nonproduction.json` records each exclusion WITH ITS REASON and the date it was read.
`mutation-worklist.mjs` ranks production functions only, and the new #1 is real work:

    1  110  oxydex-dsp.js      computeKarvonenZones
    2   88  ecgdex-dsp.js      analyze
    3   82  ppgdex-dsp.js      analyze
    4   78  integrator-dsp.js  runFusion

**FAIL-CLOSED, and the direction is the whole design.** Default is PRODUCTION. An unreadable or
malformed ledger excludes NOTHING. A wrong exclusion silently deletes real work from the queue —
unrecoverable, because nobody looks for what is not listed. A missing exclusion merely leaves noise
in a ranking, which the next reader can see and correct.

**A NAME PATTERN IS NOT EVIDENCE, and that is not hypothetical here.** The candidate search used
`/^(selfTest|gen[A-Z]|synth|mock|fake|demo|sample[A-Z]|_?fixture)/i` and returned five functions.
The fifth was `motiondex sampleHz` — which computes a SAMPLING FREQUENCY, is called three times in
its own file, and is unambiguously production. Excluding on the pattern alone would have silently
dropped four real survivors. Every candidate was read before being listed, and a selftest now pins
that `sampleHz` is never set aside.

**NOTHING IS DROPPED SILENTLY.** The excluded set is printed beside the ranked list with its total
and per-function counts, so a reader who disagrees can see exactly what was set aside and say so.
Both halves stay in the survivor total and the denominator — this changes what the list POINTS AT,
never what the programme owes. It is a ranking aid, not an equivalence claim: those mutants may well
be killable.

8 selftests, including that an empty or null ledger excludes nothing, that the key is `file::fn` so
the same function name in another file is unaffected, and that the committed ledger is non-empty —
an exclusion list that quietly became empty would restore the misleading ranking with no signal.
