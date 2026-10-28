# Unit `recut` — the HRV paper's re-run (Osprey, 2026-10-28)

**Unit.** Row `2026-09-07-ppg-ecg-hrv-paper-predates-the-fill-removal` (claim #1717, thread 7), ordered
by Kestrel after #4052 merged. Owner ruling 2026-10-27: re-cut the stale papers.

**Branch + worktree.** `claude/recut-osp` at `ad63490f5`, worktree `wt-recut-osp` (sibling of the primary
checkout). DRAFT PR **#4056**, `mergeStateStatus: CLEAN`, CI 26 pass / 2 skipping, all terminal.
`npm run check` on that head: all 41 steps passed, `EXIT=0`.

**Exact stopping point.** The worktree holds two green commits, both pushed:
`6041f5a6e` (paper note + served copy + changeset + audit record) and `ad63490f5` (three residue rows).
The undraft ask is board entry **#1935** on thread 8, addressed to Kestrel. I never undraft my own PR.

**What the unit measured.** The premise in the paper's own disclosure note and in row
`2026-10-27-the-ppg-ecg-hrv-paper-has-no-committed-producer` was wrong: `tools/ppi-jitter-vs-ecg.mjs`
has reproduced the per-epoch alignment since 2026-08-03 (#756) and holds the only `5.92` under `tools/`,
and `audits/VERITY-JITTER-CORPUS-2026-09-22.json` is a committed run of it over this paper's corpus.
A run today over the paper's stated window (2026-06-10 → 2026-07-13) reads 30 nights / 2,000 epochs,
jitter **6.34 ms** (IQR 4.61–8.83) beside the published 5.92, whole-record rMSSD bias **+6.52 %**
(IQR +1.59…+15.41) beside +4.24, beat match 100.0 %. Drift control: 12 nights with an identical
population move a median of **0.00 ms**, max 0.55 ms, 7 of 12 identical — so 134 DSP commits did not
move the jitter arm, and the gap is population plus estimator.
Pooled figures and five limits: `audits/PPG-ECG-HRV-PAPER-RECUT-2026-10-28.json`.

**Next step (for whoever resumes).** When #4056 merges: `node tools/wt-done.mjs <the wt-recut-osp path>`,
then nothing else — the two open rows this unit logged are separate units.

**Open questions.**
1. The parent row stays **OPEN** on the owner's publish-vs-retract call for the affected panels. This
   unit supplies the measurement that call needs; it does not make it.
2. Claim #1717: released at the end of this unit, because the row's next action is the owner's.

**Blockers.** None for the PR. The two new rows are build units:
`2026-10-28-the-paper-per-epoch-rmssd-and-k-fit-have-no-producer` needs a per-epoch rMSSD series arm in
`tools/ppi-jitter-vs-ecg.mjs` (per-epoch `rmssd` already exists in both epoch objects, which bounds the arm),
and the k-fit has no producer at all.

**Doc-search query that finds this work.**
`node tools/doc-search.mjs --read "ppg ecg hrv paper predates the fill removal re-cut the published jitter and rMSSD bias"`
