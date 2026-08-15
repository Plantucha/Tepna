<!--
  CORPUS-LOCATIONS.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living) · **last-verified:** 2026-08-15 · **Serves:**
`FIXTURE-CORPUS-REACHABILITY-2026-08-09-BRIEF.md` §3

# Where the raw recordings actually are

The suite's real data is **gitignored** — personal overnight recordings, never committed. So "the
corpus" is not a property of the repository, it is a property of the machine, and it lives in four
places. None of them is discoverable from a checkout, which is why this file exists.

> **The one fact that costs the most time:** a fresh `git worktree` off `origin/main` contains the
> **tracked** part of `uploads/` and none of the recordings. `CLAUDE.md` §👥.1 mandates that worktree
> for any DSP change and §🔏 mandates a `verify-fixtures` re-run for that same change, so the failure
> lands on exactly the workflow the project tells you to use. It presents as *"the corpus is absent"*,
> which reads like a fact about the machine while being a fact about the **checkout**.
>
> `tools/verify-fixtures.mjs` and the `tools/regen-*-goldens.mjs` family now resolve this themselves
> (`corpusSearch` in `tools/regen-goldens-core.mjs`: `$DEX_UPLOADS` → the **primary checkout**'s
> `uploads/` → this checkout's), and print the search when they refuse. You should not need
> `DEX_UPLOADS` by hand for the primary-checkout case.

## The four locations

Counts re-measured **2026-08-15** and they grow with every capture night — read them as scale, not as
a checksum.

| path | files | what it is | what it is for |
|---|---|---|---|
| `<primary checkout>/uploads` | 777 (**435 gitignored**, 136 tracked) | fixture inputs + committed goldens | the only one that satisfies `verify-fixtures` / the regen family — this is what `DEX_UPLOADS` wants |
| `/home/michal/tepna-smoketest/captures` | 11,646 | capture-host output, per-night tri-device | folding nights through the Integrator; `tools/trio-batch.mjs` reads this shape |
| `/run/media/…/Ecg nightly` | 1,980 | Polar Sensor Logger corpus (~19 GB) | the vendor-decode reference — validating our PMD decoders against PSL's own output |
| `vigil:/srv/tepna/captures` | 6,827 across 28 nights | the capture box, **freshest data** | anything needing recent nights; reachable over `ssh vigil` |

⚠️ **`Ecg nightly` contains a space.** Quote it. An unquoted path silently becomes two arguments and
the tool reports an empty corpus rather than an error — a false "no data" of the kind
`CLAUDE.md` §👥.4b is about.

⚠️ **`uploads/` holds two different kinds of file** and conflating them is worse than the problem this
file solves: 435 gitignored raw recordings (what `DEX_UPLOADS` redirects) and 136 git-**tracked**
committed artifacts, including every `*_equiv.node-export.json` a regen *writes*. Raw inputs resolve
through `corpusSearch`; **fixture outputs are always written to the `uploads/` of the checkout you are
running in.** Routing the write side through `DEX_UPLOADS` would make a worktree regen rewrite a
tracked file in another checkout, invisibly. See `tools/regen-goldens-core.mjs` §CORPUS ≠ FIXTURES.

## Regenerating a fixture may be an `ssh` job

`verify-fixtures` only *re-runs* the app on committed-and-gitignored inputs, so it is a local job
against the first row. But when a fixture has genuinely **moved** and needs regenerating against
recent recordings, the data may only exist on `vigil` — the box is where capture happens and the
freshest nights have not been copied down. That constraint is not visible from the regen tools.

## Do not

- **Do not copy the corpus into worktrees.** 435 files of personal overnight physiology, duplicated
  per worktree, is a storage-and-privacy answer to a documentation problem.
- **Do not make `verify-fixtures` fail open when the corpus is absent.** Its refusal is the entire
  design (`FIXTURE-VERIFICATION-GATE-2026-07-14`: *a verification you didn't run is precisely the
  false claim being abolished*). The search improves the **message**, never the verdict.
- **Do not relax §👥.1.** The worktree rule exists because sessions destroyed each other's work. The
  fix is to make the corpus reachable from a worktree, not to stop isolating.

## Cross-references

- `FIXTURE-CORPUS-REACHABILITY-2026-08-09-BRIEF.md` — the measurement and the proposals this executes.
- `FIXTURE-VERIFICATION-GATE-2026-07-14-BRIEF.md` — `verifiedUnder`, `computeHash`, and why the
  refusal must stay.
- `REGEN-CORPUS-PATH-FOLLOWUPS-2026-08-03-BRIEF.md` / `-II` — how the two halves of the fixture
  workflow came to share one resolver.
- `CLAUDE.md` §👥.1 (the worktree mandate) and §🔏 (the re-verification mandate).
