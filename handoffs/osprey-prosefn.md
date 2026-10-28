# Unit `prosefn` — the equivalence prose names its own function

**Status:** DONE — merged as `4b25b987d` (#4051) · 2026-10-28

- **Row:** `2026-10-28-equivalence-prose-misnames-the-function-on-ten-entries`, ordered by Kestrel
  on board #1894. Claimed at #1895. Closed in the PR as `fixed #4051`.
- **Branch / worktree:** `claude/prosefn-osp` in `wt-prosefn-osp`, head `600d92b7b`, cut from
  `origin/main` at `30570196e`.
- **The count:** the row measured 10 disagreements over 313 checkable entries at `5527cfef4`. The
  ref measures **11 over 315** (401 entries, 391 named). The settle and prune passes shrank the
  ledger from 434 to 401 between the two commits. All eleven repaired; the PR body names each.
- **Twelfth edit:** `ppgdex-dsp.js:250` carries no `fn`, so no control checked it, and its prose
  named `markO2Sentinels` — an export alias at `ppgdex-dsp.js:6482` with no declaration. A rename,
  same function.
- **Left alone:** `glucodex-dsp.js:1340` ×2 (the prose is right — the text sits at `:1412` inside
  `detectClampSaturation`) and `ppgdex-dsp.js:2001` (`dfaAlpha1` has no loop in its four-line body,
  the entry has no `fn`, and placing it would re-anchor on an unchecked name).
- **The pin:** `tools/reanchor-equivalence.mjs:1181` flips from `disagree.length > 0` to `=== 0`,
  keeping `checkable > 100` so it cannot pass over a ledger it never read. Selftest reads 130 of 130.
- **Gates:** `npm run check` on `ae04fcd7c` read `✓ check — all 41 steps passed`, 14592 assertions,
  `EXIT=0`, 0 `FAILED`/`ERROR`. Re-run on the pushed head `600d92b7b` — see the PR comment.
- **Next step:** ask Kestrel on thread 8 for the undraft, then watch CI. After the merge:
  `node tools/wt-done.mjs <the wt-prosefn-osp worktree>`, release claim #1895, append the unit to
  `osprey-state-2026-10-11.md`.
- **Next unit (Kestrel, #1894):** `2026-10-28-mutate-mjs-runs-its-cli-on-import-so-no-sibling-can-read-its-matcher`.
- **Open question:** none. The row's own figures are stale and the PR says so.
- **Blocker:** the undraft is Kestrel's; I never undraft my own PR.
- **doc-search query:** `equivalence excuse prose disagrees with the machine-read fn qualifier on ten entries`.
