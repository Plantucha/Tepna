---
name: kill-a-mutant
description: Use when the CI context "mutation (diff-scoped)" reports a survivor, when a mutation run reports REFUTED or UNDECIDED, or before writing or dropping an entry in an equivalence ledger — who proposes the distinguishing input, who writes the test, the hand plant that proves it, and the modules no local run may touch. Use before launching any local mutate_diff.
---

# Killing a mutation survivor

CI judges: the context `mutation (diff-scoped)` runs on every push, and the `mutation` workflow does the same for JS. Run `capture-host/check.sh` before a
push; run no local `mutate_diff` as a pre-push gate.

## The sequence

1. Read the survivor from the CI job, with its key and its function. `node tools/mutation-survivors.mjs list --open`
   lists the survivors that outlived their PR.
2. Export the source: `node tools/codex-export.mjs` prints the directory. **Source may go to an external
   model; the corpus may not.** The tool omits the data trees and the captured fixtures, and it refuses
   when one stays. Never hand-build an export.
3. Ask the API coder for ONE distinguishing input, or an equivalence argument that cites lines. Ask for
   no test code. Use `qwen-board` first. `mistral-board` is the fallback when qwen fails or a crawl holds the GPU.
   A `codex exec` call needs `--sandbox read-only --json -C <export dir>` and `< /dev/null`, or it waits forever on stdin.
   Keep the JSON log: its `command_execution` lines measure what the model read.
4. Read the answer as a claim. Run its input against the original and against the mutant.
5. Write the test yourself. It calls the code and asserts a value.
6. **Plant the mutant by hand and require red.** Restore the source and require green. Run Python with
   `PYTHONDONTWRITEBYTECODE=1 python -B`, or a stale `.pyc` answers for the mutant.
7. Run `capture-host/check.sh`. Name in the PR body each survivor the coder sized.

## Equivalence

- A "no such input" claim needs the input **space** stated, not a sample that found nothing. Ask what the
  value is PASSED TO before you accept "untestable".
- Before you write an entry, plant the mutant and show that the covering suite passes for a stated reason.
- **Never drop or weaken an entry on REFUTED alone.** The gate corroborates a kill with an isolated
  re-run; plant it as well. An orphan (a key no run generated) is an absence, not a refutation.
- An entry you drop lowers `RATCHET` in `capture-host/tests/test_equivalence_ledger.py`, in the same
  commit, with the reason in the message.
- A survivor that nobody judged stays a survivor. An excuse over an unprobed site hides it for good.

## When a local run is justified

- Never on a module in `capture-host/tools/mutate-exclusions.json`. Those report NOT_APPLICABLE in CI by
  declaration. Read the file; each entry names what retires it.
- Otherwise take the rig lock, so two runs do not time each other out:
  `flock /tmp/claude-1000/mutate-rig.lock env PYTHONDONTWRITEBYTECODE=1 <venv python> tools/mutate_diff.py --base origin/main`.
  `check.sh`, `pytest` and `npm run check` need no lock.
- Check `df -h /` first. Remove your own scratch after the run.

## Measured

- Contention made false REFUTEDs: 15 entries read REFUTED on a loaded run, and the same 15 survived on a
  quiet run and under a hand plant. A session almost deleted the 15 entries (2026-10-05).
- Three concurrent local runs put the rig at load 31. Cost per glob rose 40 %, and a clean verdict became
  UNKNOWN with 5 timeouts (2026-10-05).
- One `mutmut` child on `capture.py` reached 9 GB RSS and at least 2 h, over the 8 GB limit (2026-10-03).
- A trial showed the test code of the coder to be vacuous, so the coder sizes and you write (2026-10-04).
- Nine of nine planted mutants failed the new tests on #3730. A plant that cannot fail proves nothing.

Memory: `mutants-by-the-api-lane`, `codex-sizes-a-survivor-never-writes-its-test`,
`refuted-is-a-claim-plant-before-deleting`, `rig-mutation-runs-take-the-lock`,
`no-mutate-diff-on-capture-py-on-rig`, `a-vacuous-plant-passes-both-ways`.
