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

## 2026-10-26, second pass — rebased twice, one row added, body linted

**State.** `claude/driftclass-osp` at `0cfcc703d` in `wt-driftclass-osp`, base `origin/main` after
#3966. Two commits: `479414b1d` is the strict-exit change plus its row, `0cfcc703d` adds one OPEN row.
Rebased twice today, `bf7dd7b94` → `dc2e016e4` → `479414b1d`, both runs clean with no source conflict.
Survival after each: `git show HEAD:tools/residue-cite-drift.mjs | grep -c strictFailures` reads 4.

**Gate.** All 41 steps passed on the pre-row state. The final-state run is in flight; read its sentinel
before pushing.

**PR body.** Linted to 0 findings, in this session's scratchpad at `driftclass/body.md`. It carries the
Rule 0 line, the closure of the strict-exit row, the measured strict output and the new row.

**The naming half was already on main.** #3956 landed the key-bearing lists for `unanchored` and
`beyondEof`, and its row reads closed. My branch adds the exit half alone. This is the stale-sizing
correction from board #1468, now confirmed by reading the tool at the ref.

**New measurement, and it is the reason for the extra row.** Running the rebased tool at the ref:
858 rows, 552 citations, anchored 165, moved 311, unanchored 56, `missing-file` 17, beyond-eof 3.
14 of the 17 `missing-file` citations name a tree this repo never carried. Two name a repo file under a
name the repo does not hold, and one is a mutmut temp copy. So 14 of the strict sum's 76 are not
defects, which row `2026-10-26-the-missing-file-bin-counts-paths-this-repo-never-carried` records.

**Beyond-eof dissolves an owed row.** All three beyond-eof citations sit in rows that already read
closed, and two of the three are the same `CLAUDE.md:636` repeated inside one row. No pickup can be
misled by a pointer in a closed row, so the correcting row I was carrying for those two is not owed.

**Next step.** When #3967 merges: rebase, verify `strictFailures` reads 4 and both new rows survive,
open the PR as a draft from the linted body, read the number from `gh pr view`, move the strict-exit
row's state cell to that number in a second commit, push, then ask Kestrel for the undraft.

**Open question.** Whether the external-path bin is a third verdict or a flag on `missing-file`.
A basename lookup misbins the Data Unifier citation, so the rule needs to be stronger than that.
