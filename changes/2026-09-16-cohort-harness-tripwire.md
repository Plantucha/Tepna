---
bump: patch
type: fixed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`cohort-harness.html` now **refuses** when a node fails to initialise, instead of serving nulls for
two months.

## What it does now

Before: the realm announced `ready`, every scoring call returned without a score, and
`qrs-equiv-analysis.html` charted the nulls and reported *"analyzing 9 windows — 100 %"*, publishing a
result object with two of three Bland–Altman pairs simply **absent** and `patJitterSdMs` at its
fallback `0`.

After: `realm boot failed (pulsedex: node did not initialise — missing global(s): PulseDex)`, and
**nothing is published**.

The gap was that `ready` was sent on the strength of `loadAll` resolving — and it resolves even when a
script **throws during execution**, because `<script src>` fires `onload` on a successful *fetch* and
a `SyntaxError` inside it surfaces only on `window.onerror`. The realm now asserts the globals it
exists to provide (`REQUIRED_GLOBAL`) before announcing itself.

## The underlying break is NOT fixed, and two obvious fixes are ruled out by measurement

The DSPs are dual-form — a classic IIFE assigning `window.X`, then ES re-exports
(`pulsedex-dsp.js:1737`). A `<script src>` parses the file as classic, so the trailing `export` kills
the whole file including the IIFE. Broken by the 2026-07-16 ESM migration, three days after this page
was last touched.

The obvious remedy — fetch the text, strip the exports, inject inline, i.e. what `DexBuild.classicify`
does at build time — **cannot work in this page**. Measured in Chrome with
`--allow-file-access-from-files` on a `file://` page:

| mechanism | result |
|---|---|
| `fetch('kernel-constants.js')` | blocked outright for `file:` URLs |
| `XMLHttpRequest` | `onerror`, status 0 |
| `<script type="module">` | origin is `null` → CORS-blocked |

Only `<script src>` can read a sibling file there, which is why the original used it. **The real remedy
is build-time**: give `build-analysis.mjs` ownership of this page so it inlines classicified sources,
the way it already does for every analysis tool. That is a build-system change and is left as its own
unit; both dead ends are recorded in the file so they are not re-walked.

## Blast radius corrected — one tool, not three

`2026-09-16-cohort-harness-broken-since-esm` listed five consumers from header comments. Only
`qrs-equiv-analysis.js` actually loads the realm (`f.src = 'cohort-harness.html?node=pulsedex'`).
`cgm-hrv-coupling-analysis.js` and `treatment-response-analysis.js` merely *mention* harness realms in
their header prose — both create **zero** iframes, **zero** `.src` assignments, and score through Web
Workers instead.

**So `cgm-hrv-coupling`'s exact reproduction of its published values is genuine**, not a reproduced
defect — which resolves the open question that gated its re-cut, in the good direction. I had counted
comment mentions as consumers.
