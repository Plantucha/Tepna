<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-08-15 · **Created:** 2026-08-09 · **Follows:** `FIXTURE-VERIFICATION-GATE-2026-07-14-BRIEF.md` · **Affects:** `tools/verify-fixtures.mjs`, `CLAUDE.md` §👥.1 / §🔏

# The workflow this repo mandates cannot discharge the gate that same workflow triggers

`CLAUDE.md` §👥.1: *"Always worktree when you will touch a bundle, a ledger, or a DSP."*
`CLAUDE.md` §🔏: a DSP change moves `computeHash`, which owes a `verify-fixtures` re-run.

Those are the same work. And a worktree does not contain the corpus that re-run needs — so the
mandated isolation and the mandated verification are, today, mutually exclusive. Nothing says so
anywhere, and the failure presents as *"the corpus is absent"*, which reads like a machine fact
rather than a checkout fact.

## 1 · The measurement

`uploads/` in the shared root, 2026-08-09:

| | files |
|---|---|
| on disk | **653** |
| tracked (git) | 133 |
| untracked, not ignored | 85 |
| **gitignored — exist only in this checkout** | **435** |

A fresh worktree off `origin/main` gets **134** of those 653 — the tracked set, ~20 %. Every
corpus-backed fixture input is in the other 80 %.

This is not a bug in `git worktree`; it is what gitignored means. It is a bug in the *instructions*,
which mandate a checkout that structurally cannot run the verification they also mandate.

## 2 · How it presents, which is the expensive part

`tools/verify-fixtures.mjs` reports missing inputs and prints:

```
These are gitignored personal recordings. Point DEX_UPLOADS at the corpus:
  DEX_UPLOADS=/path/to/uploads node tools/verify-fixtures.mjs
```

That message is correct and still insufficient, because `/path/to/uploads` is a placeholder and the
reader is standing in a checkout that HAS an `uploads/`. The natural reading — *"I have uploads/, so
the corpus must genuinely be absent from this machine"* — is wrong, and it is wrong in the direction
that stops you looking. Measured this session: the corpus was present the whole time, one directory
up, and was reported as absent.

`FIXTURE-VERIFICATION-GATE` §189 has the same shape (`DEX_UPLOADS=<corpus>`). Neither says the thing
that matters: **the corpus is not in your checkout, and on a worktree it cannot be.**

## 3 · The corpus is in four places, and no document lists them

All four verified to exist 2026-08-09:

| path | files | what |
|---|---|---|
| `<root>/uploads` | 653 (435 gitignored) | fixture inputs — what `DEX_UPLOADS` wants |
| `/home/michal/tepna-smoketest/captures` | 11,430 | capture-host output, per-night tri-device |
| `/run/media/…/Ecg nightly` | 1,980 | Polar Sensor Logger corpus — **note the space in the name** |
| `vigil:/srv/tepna/captures` | 4,247 (21 nights) | freshest; reachable over `ssh vigil` |

Only the first satisfies `verify-fixtures`. The other three matter when a fixture has genuinely
**moved** and needs regenerating, because that re-runs the app on real recordings rather than
re-hashing committed bytes — so a regeneration is potentially an `ssh` job, not a local one. That
constraint is not written down anywhere and is not obvious from either the regen tools or §🔏.

## 4 · The discharge is valid as of an instant, and the instant passes

Observed this session on `integrator_tch_golden.node-export.json`:

```
verifiedUnder  f7173b2d12b9 → 95653b64ea78
```

`f7173b2d12b9` was the Integrator `computeHash` **at the moment the debt was incurred**. By the time
the corpus was pointed at it, other Integrator work had landed and the closure had moved again. The
re-verification therefore certifies current code, which is right — but it means a busy compute path
can re-open its own debt between incurring and discharging.

**This is a cost, not a hole, and the distinction matters.** CI reports the unverified state and
`release.mjs` refuses on it, so nothing ships silently. What it argues is only that discharge should
be *cheap and obvious*, because on this repo it will be done often — which is precisely what §2 and
§3 make it not.

## 5 · What must NOT be done

- **Do not copy the corpus into worktrees.** 435 gitignored files of personal overnight recordings,
  duplicated per worktree, is a storage and privacy answer to a documentation problem.
- **Do not make `verify-fixtures` fail open** when the corpus is absent. Its refusal is the whole
  design (`FIXTURE-VERIFICATION-GATE`: *"a verification you didn't run is precisely the false claim
  being abolished"*). Every proposal below keeps the refusal and improves only the *message*.
- **Do not relax §👥.1.** The worktree rule exists because sessions destroyed each other's work; the
  fix is to make the corpus reachable from a worktree, not to stop isolating.

## Proposals

1. **`verify-fixtures` resolves the corpus itself, then says where it looked.** With `DEX_UPLOADS`
   unset, try in order: `$DEX_UPLOADS` → `<primary checkout>/uploads` → `./uploads`. Print every
   candidate and its verdict. Keep refusing if none has the inputs — but refuse having *shown the
   search*, so "absent" is a conclusion rather than a guess.

   **The resolution step is verified, not assumed** (run from inside a worktree, 2026-08-09):

   ```
   $ git rev-parse --path-format=absolute --git-common-dir
   /run/media/…/Tepna/.git          →  dirname  →  /run/media/…/Tepna
   uploads there : 653 files        uploads here : 134 files
   ```

   `--git-common-dir` points at the primary checkout's `.git` from any linked worktree, so its parent
   is the corpus root. One `git rev-parse` closes §1 and §2 together, and it degrades correctly: in a
   non-worktree checkout it returns that checkout's own `.git`, making the candidate identical to
   `./uploads` rather than wrong.
2. **State the worktree consequence at both call sites** — §🔏's `DEX_UPLOADS=<corpus>` line and the
   tool's own error — in one sentence: *your worktree has only the tracked `uploads/`; the corpus
   lives in the primary checkout.*
3. **Record the four locations** (§3) somewhere a session will find them, with the regeneration note
   that the freshest data is on `vigil` and a moved fixture may need `ssh`.

## Done when

- [x] `verify-fixtures` prints its search path and finds the primary checkout's `uploads/` from
      inside a worktree without `DEX_UPLOADS` being set by hand.
- [x] The worktree consequence is stated at both call sites.
- [x] The four corpus locations are recorded, including that `Ecg nightly` contains a space and that
      `vigil:/srv/tepna/captures` is the freshest.
- [x] Refusal behaviour is UNCHANGED — verified by running with a corpus that is genuinely missing an
      input and confirming it still refuses to stamp.

## EXECUTED — 2026-08-15

**What shipped.** `corpusSearch(repo)` in `tools/regen-goldens-core.mjs` — the same module that already
holds the ONE resolver, so the two halves of the fixture workflow still cannot drift apart. It returns
every candidate *with its verdict*, in the order Proposal 1 specifies:

    $DEX_UPLOADS  →  primary checkout (git rev-parse --path-format=absolute --git-common-dir)  →  this checkout

`resolveCorpus` is now a thin front for it and keeps its old contract, so the whole regen family
inherits the search without a call-site change. `verify-fixtures` prints the chosen corpus on every
stamp run and prints the **whole search** when it refuses.

**One thing the brief did not say, and it is the reason to prefer this over copying data around.**
Preferring the primary checkout means a git-**tracked** input can now be read from a checkout at a
different commit than the one you are standing in. That is a real behaviour change, and it **fails
closed**: the input is hashed by GATE B and re-run by the node's equiv leg, so a mismatch reds the
suite and `verify-fixtures` refuses to stamp. The alternative was not running at all.

**The counts had all grown, which is itself the finding for §3.** Re-measured 2026-08-15 against the
brief's 2026-08-09 figures:

| location | brief (08-09) | now (08-15) |
|---|---|---|
| `<primary>/uploads` | 653 (435 gitignored) | **777** (435 gitignored, 136 tracked) |
| `tepna-smoketest/captures` | 11,430 | **11,646** |
| `Ecg nightly` | 1,980 | 1,980 |
| `vigil:/srv/tepna/captures` | 4,247 / 21 nights | **6,827 / 28 nights** |

Three of four moved in six days. `docs/CORPUS-LOCATIONS.md` therefore records them as *scale, not a
checksum*, with a `last-verified` date — a corpus inventory that reads like a fixture invites someone
to treat a stale count as a discrepancy.

**Refusal behaviour is unchanged, and that was checked rather than reasoned about** (Done-when 4): run
against a corpus genuinely missing an input, the tool still exits **2** and stamps nothing — it now
shows the three places it looked first. The refusal is the design; only the message moved.

**§4 remains a filed cost, not a hole.** Nothing here shortens the window between incurring a
verification debt and discharging it; it only makes the discharge cheap, which is what §4 asked for.

## Cross-references

- `FIXTURE-VERIFICATION-GATE-2026-07-14-BRIEF.md` — the gate this serves; `verifiedUnder`, `computeHash`,
  and why the refusal must stay.
- `CLAUDE.md` §👥.1 — the worktree mandate this collides with.
- `CLAUDE.md` §🔏 — the re-verification mandate, and the `DEX_UPLOADS=<corpus>` line to amend.
- `REGEN-CORPUS-PATH-FOLLOWUPS-2026-08-03-BRIEF.md` / `-II` — prior corpus-path work on the regen side.
- `CITATION-ATTRIBUTION-FOLLOWUPS-II-2026-08-08-BRIEF.md` §1 — the debt whose discharge surfaced this.
