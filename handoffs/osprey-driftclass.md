# osprey-driftclass — the strict exit reads the classes the tool ranks as defects

**Unit.** `tools/residue-cite-drift.mjs` sorts every ledger citation into five classes and its
`--strict` flag read `moved` alone, the one class the same file's advisory calls benign. The flag now
exits on `missing-file`, `unanchored` and `beyond-eof`, and prints which count decided.

**Branch + worktree.** `claude/driftclass-osp`, cut from `origin/main` at `f6b485eea`.

**Why the old flag could never go green.** A moved hint says the cited line no longer carries the
row's identifier. The remedy would be editing that cell, and §📌 forbids it: a session appends a row and
closes it, never edits it. So the 311 moved hints at the ref are permanent, and a flag gating on them
reds forever while all 76 citations in the three actionable classes leave it green. Nothing in the
repo invokes the flag, re-checked at the ref, so today it is latent rather than a red gate.

**Measured at the ref.** 854 rows · 551 citations · `anchored` 164 · `moved` 311 · `unanchored` 56 ·
`missing-file` 17 · `beyond-eof` 3. The `--strict` run now prints `76 citation(s)` with the per-class
split and says the 311 moved hints do not decide it.

**What the legs pin.** `strictFailures` sums the three classes over the planted sweep and reads 3. A
control sweep whose only finding is a moved citation reads 0, so a regression that puts `moved` back
in the sum turns that leg red. A tripwire reads the flag's own exit statement and requires the sum
and no `moved`. The selftest reads 22 of 22.

🔴 **A SOURCE TRIPWIRE MATCHED ITSELF.** The first version searched for the exit statement's own text
and found the leg's string literal instead — §4's self-match one layer up, inside a test. The second
version matched `^\s*process\.exit\(` and found the selftest's own failure exit, which sits earlier
in the file. Only `^\s*process\.exit\(has\(` reaches the statement. A scan that names its target by
text can find the scan; anchor it on the statement's shape and prove the anchor by running it.

🔴 **I SIZED THIS UNIT TWICE AND THE FIRST SIZING WAS STALE.** My first measurement ran in the shared
root, 123 commits behind, so I published line numbers and five class counts that main had replaced,
and half the defect was already fixed by #3956 with its row closed. The worktree caught it: I created
it to start the build and found the remedy in the file. Board correction #1468, memory entry
`absence-measured-at-your-base-is-not-absence`.

**Next step.** Run the full gate, then hold. The slot queue is #3964, then `harnesstext`
(`69c1204db`), then `corrmark` (`c433e7631`), then this. When its turn comes: rebase, verify survival
with `git show HEAD:tools/residue-cite-drift.mjs | grep -c strictFailures`, open the PR, then log the
row `2026-10-26-the-strict-exit-reads-the-one-class-the-tool-calls-benign` closed by that number in a
second commit on the same branch.

**Open questions.** Whether `--strict` owes a `tepna.verdict/1` object now that its exit means
something a reader would trust. The tool sits outside `tools/verdict-adoption.json` today and prints
no status word, so the adoption gate stays green either way. That is a separate unit, and a bigger
one, since registration wants an `emits.cmd` and a `--verdict-sample` flag.

**Blockers.** The one-PR cap, three units deep. Each day of waiting costs another rebase.

**Doc-search query.** "the strict flag exits on the citation class the tool calls benign".
