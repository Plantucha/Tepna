---
bump: patch
type: changed
brief: none
---

**Other projects' names out of the tree, and a gate that keeps them out.**

Owner ruling 2026-10-10 ("do not use other project names") applied backwards over `main`: **53
occurrences across 33 files** — 8 briefs, 6 capture-host modules, `ecgdex-dsp.js`, `tests/dex-tests.js`,
`DOCS-INDEX.md`, two `docs/` notes — replaced by the behaviour, the measurement, or "the reference
implementation". 15 generated files cleared by re-bundling.

`tools/no-third-party-names.mjs` (new, static lane, `npm run check` step) holds the criterion
`third_party_name_hits lte 0` over every tracked file, with no grandfathered set. **It holds its
needles as base64**, so it is not a hit on itself and its own failure output can never reintroduce
what it forbids: a hit names the file and line, never the word.

🔴 **The sweep's scope was a third of what the first count implied, and the difference was clinical
vocabulary.** A stem count said 73 files; **40 of those were `polysomnography`** — in two user-facing
reference guides, a published paper, and the download paths of a public dataset, where editing the
string breaks the fetch. The gate therefore matches the FULL name on a word boundary, never a stem,
and asserts that directly.

ECGDex was the one carrying bundle: `manifestHash 17fa7947d075 → 36b2fc59f95e`, and **`computeHash`
moved too** (`67f39a9b6c71 → 06a362d275d4`) — a DSP comment is DSP text, and the compute closure is a
denylist that fails closed. Its 4 goldens were regenerated (code identity only; no output changed) and
re-verified on the real corpus: suite green, 1 stamped, 18 already current.
