# Magpie — PpgDex goldens recorded in the realm the PpgDex bundle runs in

**Unit:** residue `2026-09-22-ppgdex-fixture-spread-not-bundle-reproducible`
**Branch:** `claude/ppgspread-mg` · **Worktree:** `wt-ppgspread-mg` · **Base:** `f48a03d77`
**Rule 0 query:** `a committed fixture holds a field the shipped bundle cannot compute because clock.js is absent`
→ `briefs/RESIDUE.md` (the row), `measurement · fixture code identity` in `tests/dex-tests.js`,
`tools/regen-oxydex-goldens.mjs:49`, `tests/run-tests.mjs:1007`,
`briefs/FIXTURE-VERIFICATION-GATE-2026-07-14-BRIEF.md:57`. No landed fix.

## What the unit found

The row named `measurement.*.window.spreadMs` and `recording.hostAxis` and proposed stripping them from
the fixture-identity and equivalence gates. **Stripping is not enough.** Running the PpgDex regen realm
with and without `clock.js` moves **23 / 23 / 20 / 7 / 0 fields** on the five reachable goldens:
`recording.contentId`, `recording.hostAxis`, `window.spreadMs` · `spreadReason` · `timingSource`,
`evidence.inputHash`, and up to fifteen `timeseries.ppi.tSec` values. `hr` and `rmssd` do not move.
A host-axis correction the shipped bundle never applies produced the beat train itself.

Root cause: `tools/realm-manifest.js` `PPG_REALM` listed `clock.js`, which `PpgDex.src.html` does not.
The comment justified it by claiming the DSP aliases `DexClock.parseTimestamp` at load; every `DexClock`
read in `ppgdex-dsp.js` is `typeof`-guarded, so the module's presence only flips those guards.

## What the diff does

- `tools/realm-manifest.js` — `clock.js` out of `PPG_REALM`, with the measured cost in the comment.
- Five goldens re-recorded by `node tools/regen-ppgdex-goldens.mjs`; `provenance/PpgDex.json` carries
  five `outputHash` changes and no `verifiedUnder` churn.
- `tests/dex-tests.js` — `shellOmitsModule` / `inBundleRealm` / `shellNameFor`; the two named PpgDex
  equiv groups and the twenty-four-case Phase-9 loop recompute with `DexClock` hidden for any node
  whose own shell omits `clock.js`; a new leg in `tools · realm-manifest · single-source` reds a realm
  loading a module its node bundles omit.
- `tests/run-tests.mjs` + `Dex-Test-Suite.html` — `env.realmGlobal`.
- `changes/2026-10-25-ppgdex-goldens-in-the-bundle-realm.md`.

No bundle source changed, so no `manifestHash` or `computeHash` moves and nothing re-bundles.

## Two lessons worth keeping

1. **The node lane runs the suite in the HOST context and the modules inside a vm.** A group reaching
   `globalThis` to hide a co-loaded global hides nothing. The first attempt did exactly that; the
   group's own ANTI-VACUITY leg caught it. `env.realmGlobal` is `ctx` in node and `window` in browser.
2. **Two named groups were not the population.** The generic twenty-four-case equiv loop in the same
   file reds at step 14/40 of `npm run check` and never appeared in `--group=ppgdex`. A targeted run
   proves a group, never a gate.

## Stopping point

Full gate relaunched on the final state after the Phase-9 fix. Then: commit by explicit path, push,
open ONE DRAFT PR from the body drafted in the session scratchpad.

## Owed next, NOT in this PR

- `PpgDex_2026-06-27_equiv` is corpus-backed and the corpus is offline here (`/srv/data/tepna-corpus`
  resolves to an unmounted NFS path), so it still holds co-loaded values. On a corpus-equipped checkout
  its equiv leg will RED — that is the gate working. Remedy is one command:
  `node tools/regen-ppgdex-goldens.mjs && node tools/verify-fixtures.mjs`. Needs its own residue row.
- The ledger closure of `2026-09-22-ppgdex-fixture-spread-not-bundle-reproducible` rides a separate
  RESIDUE-only PR that Kestrel sequences; this PR does not touch `briefs/RESIDUE.md`.
- **Owner question in the PR body:** a suite run stamped that fixture's `verifiedUnder`, and it ran in
  the co-loaded realm. Not hand-cleared. Inlining `clock.js` into PpgDex would also close the row and
  stays the owner's call (CLAUDE.md §✅, and Kestrel's guard of 2026-10-24).
