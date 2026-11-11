---
bump: patch
type: fixed
brief: none
---

Five text extractors stripped tags with a multi-character pattern replaced by an empty string. CodeQL reads that shape as an incomplete sanitizer.

- `stripJats` in `tools/zotero-fill.mjs` now calls `stripElement` and `stripTags` from `tools/strip-markup.mjs`.
- Three label readers in `tests/dex-tests.js` now call `dexDropAngles`, an index scan with the same output as the old pattern.
- The inline-handler scan replaces each script and style block with a space.

The codegen registry strip stays as it is until the open clock and metric-registry spine units land.
