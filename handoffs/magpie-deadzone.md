# Magpie · unit `deadzone`

**Unit:** residue `2026-10-28-the-lint-allow-list-omits-the-rule-that-sees-a-dead-zone-read`, with the sibling row `2026-10-28-the-cvhr-cost-phase-publishes-a-population-before-the-publisher-exists` under it.
**Branch:** `claude/deadzone-mg` · **Worktree:** `wt-deadzone-mg` · **Base:** `origin/main`
**Rule 0:** `node tools/doc-search.mjs --read "biome lint allow-list correctness rule not enabled"`

## What moved

- `biome.json` arms `correctness/noInvalidUseBeforeDeclaration` at error for the whole tree.
- `tools/cvhr-edge-widen.mjs` declares `publishPopulation` above the no-stream refusal that calls it. That call was a guaranteed ReferenceError on the one path with nothing to measure.
- `hrvdex-dsp.js`, `oxydex-dsp.js` and `pulsedex-dsp.js` carry a per-site `biome-ignore` over the hoisted namespace idiom.
- `integrator-dsp.js` and `tests/dex-tests.js` rename a second `var` that re-declares a name in one function scope.
- `tests/dex-tests.js` gains the group `The dead-zone rule is armed for the whole tree`, three assertions, two of them planted.
- Four bundles, their two orchestrators and the `docs/` copies rebuilt.
- `analysis/treatment-response-yield-pin.json` takes a digest re-stamp with a note per file. The history floor in the suite rises to 8 so the new notes keep the same protection.

## Why the two rows land together

Arming the rule needs the tree at zero violations, and the cvhr call is the one real throw it finds. The claims are board entries #1903 and #1906 on thread 7.

## State

Lint, typecheck and the full node suite pass. The pinned-yield group passes 15 assertions after the re-stamp. `npm run check` runs on the final state before the push.

Fleet-Session: Magpie
