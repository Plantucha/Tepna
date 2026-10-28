---
bump: patch
type: fixed
nodes: [suite]
brief: none
---

`biome.json` turns the recommended correctness set off and names nine rules in its place. A rule nobody names is not a rule anybody relaxed — nothing reads it, and the omission leaves no trace in any log.

`noInvalidUseBeforeDeclaration` sat outside that list. Under it, `tools/cvhr-edge-widen.mjs` called `publishPopulation(0)` seven lines above the `const` that defines it. The no-stream path threw a ReferenceError where it meant to print a NOT_RUN verdict naming the absent corpus. That declaration now sits above the refusal that calls it.

The rule is an error for the whole tree. It found 18 diagnostics over seven sites, and six of the seven cannot throw.

Three are the hoisted namespace idiom in HRVDex, OxyDex and PulseDex. Each carries a per-site `biome-ignore` saying why a hoisted read is safe. That is the repo's own idiom, and what the override group beside it already asks for. Three more read a `var` that a later `var` of the same name re-declares in one function scope. Those re-declarations got their own names, in `integrator-dsp.js` and in the suite, because the second `var` quietly clobbers the first.

A planted `const n = value; const value = 1;` makes the lint exit 1, and the repo's 472 files exit 0.

The comment lines move four bundles and the two orchestrators. The treatment-response yield pin takes a re-stamp rather than a re-cut, with a note per file naming the one-line diff.
