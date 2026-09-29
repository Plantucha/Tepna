---
bump: patch
type: fixed
brief: none
---

Four analysis tools shipped a SyntaxError and could not boot. `tools/build-analysis.mjs` injected its
~1.9 MB blob-worker shim with a replacement **string**, and `String.prototype.replace` scans a
replacement string for `$&`, `` $` ``, `$'` and `$n`. `oxydex-dsp.js:695` carries the comment
``only the anchored `$` keeps them apart`` — ordinary prose about a regex anchor — and the `` $` `` in it
means *the portion of the subject before the match*, so it expanded to the entire document prefix and
spliced `<!DOCTYPE html>…` into the middle of the `var __WSRC = {…}` string literal. The literal never
closed, the block was a SyntaxError, `__mkWorker` was never defined, `new Worker` never ran, and every
tool that inlines `oxydex-dsp.js` hung forever at *"booting 8× OxyDex + 8× PulseDex realms…"*.

**Blast radius: 4 of 11 blob-worker tools**, all spliced at the identical offset +213503, which is that
one comment: `cgm-hrv-coupling-analysis.html` · `hrv-confound-analysis.html` · `nights-icc-analysis.html`
· `treatment-response-analysis.html`. Introduced by #3070 (2026-09-25). The 11 owned bundles and the 2
orchestrators were never at risk — `tools/build-core.js` concatenates inlined content rather than passing
it as a replacement — and the box serves none of the four.

**The fix is the shape, not the instance.** All three inliner injection sites now replace through a
function, which receives the capture groups as arguments and interprets nothing:
`build-analysis.mjs` (the shim), and `build-docs.mjs`'s `upsertMeta` (whose block is built from authored
page titles and descriptions — prose that can contain a `$`) and version footer. The comment in
`oxydex-dsp.js` is untouched; it was never the defect.

**And the gate that was missing.** `npm run verify:analysis` rebuilds and compares byte-for-byte against
the committed file — but the builder produced the corruption deterministically, so build output matched
build output and the check passed for three days. A generator compared against itself establishes only
that the generator is a function. `every builder-inlined script block parses` now asks the question that
would have failed on the day: 481 blocks, 33.6 MB, ~200 ms, over every built artifact at the repo root
and in `docs/`. It REDS on origin/main's build, naming all four. Two plants pin the mechanism rather than
the symptom — a replacement string expands `` $` `` into the subject prefix, a replacer function carries
the same text through untouched — and three assertions hold the shipped injection sites on the safe side,
because a tree that parses today regresses on the next `$` a comment gains.

Residue `2026-09-28-generator-compared-to-itself-examines-no-artifact` records what is still open: every
`verify:*` step is a builder-vs-builder comparison, parsing is now asked, and booting is asked of nothing.
