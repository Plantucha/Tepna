---
bump: patch
type: fixed
nodes: [suite]
brief: residue 2026-09-06-twin-builders-three-export-shapes
---

The four committed twin-input builders exposed three different browser shapes, and the Node lane
could not see it.

`require` returns `module.exports` whatever a file put on the global, so the Node lane is structurally
blind to classic-script shape — and the four files had drifted. `tch-golden-inputs.js` published only
a NAMESPACE (`root.TchGoldenInputs = { tchGoldenInputs }`), so a consumer written against the bare
`tchGoldenInputs` — correct against its siblings, and correct in Node against all of them — threw in
the browser. `respiration-fusion-twins.js` was unwrapped and leaked three private helpers
(`respExport`, `RT0`, `RSPAN`) onto a `window` all four files share.

It surfaced on #2264 as green in Node and red on `browser-gates` alone, reported as
`(intermediate value)(intermediate value)(intermediate value) is not a function` — naming neither the
builder nor the lane — and CI prints only the summary count, so identifying it needed a local
playwright run reading `div.test.no` out of the DOM.

All four now expose their bare name and nothing but their own identifier. `TchGoldenInputs` is kept
as a back-compat alias (the shared suite and the consumer's `pick()` both read it) and every
`module.exports` surface is unchanged, so no Node consumer moves.

Gate-backed in the NODE lane, which is the part that was missing: the new `tests · twin-builders`
group evaluates each builder in a bare `vm` context — classic-script semantics, no `module`, no
`require` — so `Object.keys(ctx)` is what a `<script src>` tag puts on `window`. The registry is read
from the loaders (`run-tests.mjs`'s own require sites, `Dex-Test-Suite.html`'s script tags) rather
than hand-kept, so a fifth builder is covered with no edit, and one wired into only ONE loader is
reported by name. Six assertions; each demonstrated red against the real pre-fix files.
