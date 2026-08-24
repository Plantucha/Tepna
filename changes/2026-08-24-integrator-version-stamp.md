---
bump: patch
type: fixed
brief: none
---

`Integrator.src.html` — the fusion layer shipped **v2.8.0 with no version displayed anywhere**, the
only one of the nine GATE-A bundles missing it. Both presentation anchors now carry a placeholder the
build overwrites, so `<title>` and `.logo-sub` read the real suite version.

**Why it silently never stamped, and why no gate saw it.** `projectVersion` replaces an *existing*
semver (`(class="logo-sub">\s*)v\d+\.\d+…`). Integrator had the `.logo-sub` anchor but no semver
inside it, so the regex matched nothing and the bundle was left byte-identical — exactly like an
orchestrator, which is exempt *by design*. `build.mjs --check` byte-compares, and stable output is
green output. **A stamp that matched nothing is indistinguishable from a stamp that was not needed.**

⚠️ **The version must LEAD the anchor.** `class="logo-sub">v1.0 · Fusion Layer · Ganglior` stamps;
appending it — the obvious reading — matches nothing, because the pattern requires the semver
immediately after the tag. Verified against the real regex before building, not after.

**The actual fix is the gate.** `tests/build-core-tests.mjs` now asserts, for every bundle in
`MANIFEST_BUNDLES`, that the built artifact's `<title>` carries the CURRENT `suite.manifest.json`
version. Every existing leg tested `projectVersion` against synthetic strings and all of them passed
while a real bundle shipped blank — a presence assertion on the artifacts is the only kind that can
see an absence.

⚠️ **The anchor is `<title>`, deliberately, and this was measured rather than assumed:** title **9/9**,
`.logo-sub` **7/9**, `.version-badge` **6/9** — CPAPDex and MotionDex carry neither of the latter, so
asserting `.logo-sub` would red two healthy bundles and train readers to ignore the test.

`manifestHash` **INVARIANT — `8c1072b85159 → 8c1072b85159`**, confirmed against the provenance
fragment rather than assumed from §📦's guarantee: the stamp lands outside every `data-inline-src`
block by construction, so no fixture moved. GATE A 9/9, GATE B 18 reproducible, `build.mjs --check`
clean across all 11 owned bundles, `docs/` current.
