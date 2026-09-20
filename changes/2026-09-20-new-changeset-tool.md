---
bump: minor
type: added
brief: none
---

Resolve a changeset's `brief:` at write time, and point authors at the 4-second check that already
existed.

## The defect, and the part of it that was NOT missing

`brief:` took a hand-typed filename and the only thing that said it was wrong was a CI lap — three
sessions in one night, each learning it from a red `check5`.

⚠️ **But `check5` was never the gap, and I measured that before building anything.** It has always
resolved `brief:` against the real brief set, and it has always been fast:

| | |
|---|---|
| `node tests/run-tests.mjs --group=release-ledger` | **4.2 s** |
| the CI lap that was actually telling people | **~6 min** |

Verified discriminating rather than assumed — a planted `brief: TOTALLY-MADE-UP-2026-01-01-BRIEF.md`
reds that local run with the exact message, so it genuinely resolves briefs rather than skipping when
the set is absent. **The check was never missing; the 4 seconds were never on offer.** Nothing in
`changes/README.md` named the command, and `CONTRIBUTING.md` names the *gate* (`release-ledger`) without
saying you can run it.

So this adds **no third validator**. Answering a real finding by building a layer next to the working
one is the owner's question 5, and `check5` is correct.

## What it does instead: remove the hand-typing

`tools/new-changeset.mjs` takes `--brief` as a **fragment** and resolves it against the real `briefs/`
set — one match is written in full, several **refuse** and list them, none **refuses** and shows the
nearest by shared word. **There is no spelling for a brief that does not exist**: the tool declines
rather than emitting it, which is question 1 applied to the field that caused this.

Bump, type and slug are validated the same way, against `check5`'s own vocabularies.

## `none` is the default, deliberately

Omitting `--brief` writes `brief: none`. **A plausible-but-wrong brief PASSES `check5`** — it resolves,
so the gate is satisfied — **while sending the next reader somewhere the defect never was.** That is the
residue ledger's source-cell trap one artifact over, and a tool that made `none` harder than a guess
would manufacture bad citations at the rate people are unsure. The refusal messages say so explicitly.

**This changeset was written by the tool**, `brief: none`, which is also the correct answer for it: the
work came from a residue row, not a brief.

## Tests

11 selftests (`node tools/new-changeset.mjs --selftest`), **positive control first** — a unique
fragment must resolve, or a resolver that refused everything would pass every refusal test. Then: exact
match, case-insensitivity, ambiguity refusing rather than picking the first, unknown refusing with
candidates, `none` both by omission and explicitly, and the emitted frontmatter matching **`check5`'s
own `^brief:\s*(\S+)\s*$` regex** rather than a restatement of it.

Exit codes verified directly rather than through a pipe: `2` on refusal, `0` on success.

## Also

`docs/TOOLS-INDEX.md` regenerated — adding a tool stales it, and `verify:tools-index` is a gate step.
