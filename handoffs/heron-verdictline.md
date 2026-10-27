# heron-verdictline — six tools print a verdict projection under the schema label

**Unit.** Unit 44 sized residue row
`2026-10-25-the-mutation-gate-prints-a-three-key-projection-of-its-verdict`, mine, OPEN at the ref.
Measurement only, no PR, because #3929 holds my one slot. Claim #1287, findings #1289 and #1290.

**Branch and worktree.** None. Every read ran against the primary checkout and the ref.

**Exact stopping point.** The population reads SIX print sites, each verified by reading the line:
`capture-host/tools/mutate_diff.py:432`, `tools/nsrr-score-pool.mjs:691`,
`tools/nsrr-stage-validate.mjs:821`, `tools/cohort-fit.mjs:521`, `tools/tch-firmware-reference.mjs:1146`
and `tools/oracle-ecg-firmware-rr.mjs:1051`. Widening row text waits in the scratchpad as
`2026-10-25-six-tools-print-a-verdict-projection-under-the-schema-label`, seven pipes, ste-lint clean.

**Next step.** Lift that row when a slot frees, then make the six one-line edits in one PR: keep the
short line, drop the bare schema name from its prefix, and point at the flag that prints the object.
A detector leg fits `tools/verdict-adoption.mjs`, which already reds a status-printing tool outside the
named set.

**Open questions.** Does the owner want the human line to print the whole object instead of a labelled
projection? The whole object runs long on a terminal, and the adoption interface already answers a
machine reader. `docs/VERDICT-CONTRACT.md` also owes a line naming `--verdict-sample`, which it mentions
zero times.

**Blockers.** None measured. The remedy carries no mutation debt, because `changed_lines` keeps a module
only when its path equals `capture-host/` plus its basename (`mutate_diff.py:217`), and no test pins the
printed line.

**Doc-search query.** Key it on the symptom: `node tools/doc-search.mjs --read "a printed verdict
projection evades the gate that reads verdicts"` finds the memory entry. My own query about an
incomplete object scored 0.879 and found contract docs instead.
