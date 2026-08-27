<!--
  CORPUS-LOCATIONS.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living) · **last-verified:** 2026-08-17 · **Serves:**
`FIXTURE-CORPUS-REACHABILITY-2026-08-09-BRIEF.md` §3

# Where the raw recordings actually are

The suite's real data is **gitignored** — personal overnight recordings, never committed. So "the
corpus" is not a property of the repository, it is a property of the machine, and it lives in four
places. The **CPAP corpus is a subdirectory of row 3** (`Ecg nightly/CPAP`) rather than a fifth
location — see below, including how a wrong search term produced a false "it isn't here". None of them
is discoverable from a checkout, which is why this file exists.

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

⚠️ **Row 2 is a SYMLINK, and `find` silently reports nothing through it.**
`/home/michal/tepna-smoketest/captures` → `/srv/data/tepna-smoketest-captures`. `find` does not follow
symlinked *start points* by default (`-P`), so it treats the path as a plain file, matches nothing, and
**exits 0 with no error**. Measured 2026-08-27:

```sh
find  /home/michal/tepna-smoketest/captures  -name '*_ECG.txt' | wc -l   # → 0     ← false "no data"
find -L /home/michal/tepna-smoketest/captures -name '*_ECG.txt' | wc -l  # → 505
find  /home/michal/tepna-smoketest/captures/ -name '*_ECG.txt' | wc -l   # → 505   (trailing slash)
ls    /home/michal/tepna-smoketest/captures/*/*_ECG.txt      | wc -l     # → 505   (glob follows)
```

**Use `find -L`, or a trailing slash, or a glob.** The tell that it is the instrument and not the
corpus: a child directory searches fine while its parent returns zero — and `ls` disagrees with `find`
on the same tree. This is the same class as the space above (a silent empty result standing in for an
error, `CLAUDE.md` §👥.4b), and it cost real time before it was spotted: it presents as *"the box
captures aren't on this machine"*, which is a statement about the corpus while being a statement about
`find`.

⚠️ **Do not diagnose it with stderr suppressed.** `2>/dev/null` also hides a missing binary, so a
`… | wc -l` of 0 can mean "no matches", "not a directory", or "command not found" — three different
facts wearing one number. Drop the redirect first.

⚠️ **`Ecg nightly` contains a space.** Quote it. An unquoted path silently becomes two arguments and
the tool reports an empty corpus rather than an error — a false "no data" of the kind
`CLAUDE.md` §👥.4b is about.

⚠️ **`uploads/` holds two different kinds of file** and conflating them is worse than the problem this
file solves: 435 gitignored raw recordings (what `DEX_UPLOADS` redirects) and 136 git-**tracked**
committed artifacts, including every `*_equiv.node-export.json` a regen *writes*. Raw inputs resolve
through `corpusSearch`; **fixture outputs are always written to the `uploads/` of the checkout you are
running in.** Routing the write side through `DEX_UPLOADS` would make a worktree regen rewrite a
tracked file in another checkout, invisibly. See `tools/regen-goldens-core.mjs` §CORPUS ≠ FIXTURES.

## The CPAP corpus — a subdirectory of row 3, and it was there the whole time

Added 2026-08-17 while re-measuring `OXYDEX-PB-DETECTOR` §3.3's κ. Three shipped tools need a CPAP
export set:

| tool | needs |
|---|---|
| `tools/cpap-corpus.mjs` | `--root <dir>` — a ResMed tree, `<root>/YYYYMMDD/YYYYMMDD_HHMMSS_{BRP,PLD,SA2,EVE,CSL}.edf`; builds the export set |
| `tools/pb-agreement.mjs` | `--cpap <cpap-exports.json>` from the above |
| `tools/pb-fusion-blast.mjs` | the same |

| path | nights | files | what it is |
|---|---|---|---|
| **`<647A>/Ecg nightly/CPAP`** | **192** (2026-01-11 → 07-21) | 1194 | the ResMed corpus, already in card layout — point `--root` straight at it |
| `/run/media/michal/data/Ecg-nightly-archive/CPAP` | 192 | 1194 | a **byte-identical mirror** (0 name or size differences) on the second volume |

> 🔴 **AN EARLIER VERSION OF THIS SECTION SAID THE CPAP CORPUS WAS ON THE *OTHER* VOLUME. IT WAS NOT —
> and the misdiagnosis is more useful than the fact.** The sequence, 2026-08-17:
>
> 1. I searched `<647A>` for `DATALOG` and `STR.edf`, got nothing, and wrote *"the corpus is not on
>    this machine."* **Neither marker exists in this layout** — the nights are date-named folders
>    directly, and there is no `STR.edf` anywhere in it. I searched for the wrong thing.
> 2. **That `find` also TIMED OUT at 120 s and was backgrounded; its output file was empty.** I read an
>    empty file from an *incomplete* search as a negative result. This is `CLAUDE.md` §👥.4b exactly: a
>    query that never finished, reported as an answer.
> 3. On being told the corpus existed, I found the `/data` mirror and concluded *"it was on the volume
>    I never searched"* — a tidy story that explained the symptom and was still wrong. It is on **both**.
>
> Two mounted volumes do exist (`ls -d /run/media/michal/*/`) and that is worth knowing. But the volume
> was never the problem: **`<647A>/Ecg nightly/CPAP` was inside a path this file already listed.**
> A wrong search term plus an unfinished search produced a false absence, and the first explanation
> that fitted the evidence was accepted without re-testing it against the volume I had already walked.

⚠️ `uploads/` also holds **3** flat CPAP nights (2026-06-12, -13, -16) as loose `*_CSL/EVE/BRP/PLD/SA2.edf`.
They are fixture inputs, **not** a corpus — do not point `--root` at `uploads/`.

⚠️ **And the wrong-layout failure is silent.** `cpap-corpus.mjs --root` pointed at a directory holding
the right files in the wrong shape does not error: it prints
`nights: 0 | therapy hours: 0.0 | ganglior events: 0` and **writes a valid, empty exports file, exiting
0**. Downstream that reads as *"the comparison ran and found no agreement"* — a different and much
worse claim than *"the corpus was absent"*. Check the night count, never the exit code
(`CLAUDE.md` §👥.4b).

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
