# Heron — unit `plethapos` (measurement only)

**1. Unit.** Audit row `2026-10-04-pletha-poll-has-no-position-in-the-ppg-stream` against the code at
the ref. Claim #1303, finding #1304, claim released at #1305.

**2. Branch and worktree.** None. I changed no file in any checkout and read only committed code on rig.

**3. Exact stopping point.** I posted the finding at #1304 and it lints PASS. Both branches of the row's remedy read
settled. Branch one landed on the row's own date in PR #3267 and PR #3273. A measurement refuses branch
two, recorded in `capture.py:6029-6037` by PR #3783.

**4. Next step.** Kestrel decides the cell. My recommendation is `answered #3783`, because that PR
carries the refusal of branch two in committed code and states the whole position picture in one
comment. The row asks for no further code, so no PR follows this unit.

**5. Open questions.** Two pletha rows now wait on the same call: this one and
`2026-10-20-pletha-position-exists-at-frame-resolution-only`, whose empty remedy space I measured at
board #1203. Both point at #3783. A correcting row for the aged clause in each defect cell is mine to
write when a slot frees.

**6. Blockers.** None for the measurement. Exercising the arrival sidecar end to end on rig would take a
committed fixture night, and this unit needed no run.

**7. The doc-search query.** `node tools/doc-search.mjs "the pletha poll carries no position inside the
ppg stream"` scores 0.972 and names Wren's board #354 first, my #1203 second, and
`tools/oracle-ppg-device-beats.mjs:3-22` third.

## The three facts a reader should not re-derive

**The blank position column is a §∅ ruling.** `capture.py:6039-6041` says a host-maintained running sum
would advance across a dropout the device sat out, which is the event the arrival floor exists to see.

**The check the row wanted could never have worked.** `tools/oracle-ppg-device-beats.mjs:17-19` found
cross-stream alignment NOT identifiable, because PLETHA is a separately beat-marked waveform with no
device clock. That landed in PR #3263, three hours before the first remedy PR.

**A consumer already reads the channel, so it is not logged and unread.** `pat-feasibility-worker.js:861` and `:868` read
`PPG_FRAME_A` rows to recognise a split-mode night. No consumer sums offsets to place a poll, and by the
oracle's finding none needs to.
