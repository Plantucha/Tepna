---
bump: patch
type: fixed
brief: none
---

**Two tool-lane residue rows, both the same shape: a comparator nobody ran.**

- `codegen/generated/` is a frozen copy of `dex-gen.js` and `dex-registry-gen.js` output, and nothing
  ever compared the committed bytes with the generators. `dex-gen.js` gains `--check` (byte-compare,
  writes nothing, exit 1 on drift or an unreadable target), `package.json` gains `verify:codegen`
  covering the page and the registry, and the sixth generated tree now has a guard in `npm run check`
  **and** in CI's `static` job.
- `queue-doctor --report` printed only the green-and-stuck set, so a PR with a red REQUIRED check read
  as an idle queue and the tool exited 0 over it. A new exported `attention()` returns both sets, the
  report names failing PRs, and `--report` exits 1 on either.

The drafts came from the API fix lane. ⚠️ The codegen one shipped `verify:codegen` in `package.json`
while nothing invoked it — a gate that runs for nobody is the defect the row is about, so the wiring
into `run-check.mjs` STEPS and the CI step were added here.
