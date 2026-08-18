---
bump: patch
type: changed
brief: PAT-RELATIVE-REFRAME-2026-08-17-BRIEF.md
---

**Three §5 done-when items verified against shipped code — one was already complete, one is a guard
that must stay unchecked, one is blocked on data rather than effort.**

No code changes. The value is that a later session ranking work by unchecked boxes would have redone
finished work and graded a metric that does not exist.

- **"The two fiducial defects of §3.4"** → **CLOSED**. ⚠️ The reference was dangling — this brief has
  no §3.4. The defects meant are the ones its own *"the first ankle diagnosis was WRONG"* section
  describes: self-inclusion degeneracy in the rolling-median baseline, and biggest-with-biggest
  pairing across non-overlapping sessions. Both verified present on `main` **by identifier**
  (`leave-self-out` in `pat-align.js`, `anklePair`/`overlapMin` in `tools/pat-dip-index.mjs`), not
  from memory. Export-inert here is **structural**: `pat-align.js` is inlined into **0** bundles and
  `pat-dip-index.mjs` is not in `build-analysis.mjs`'s `TOOLS`, so neither can reach a compute
  closure and no fixture can move — the computed form §🔒 requires, not the prose form it abolished.
  The box was stale against prose two screens above it.
- **`patArousalIdx` registry row** → stays **unchecked, deliberately**. The identifier appears in **no**
  source file, so this is a guard on future work, not a backlog item; adding a row now would grade a
  metric that does not exist.
- **Within-connection offset stability** → ~~blocked on the sidecar~~ **NOT BLOCKED — corrected same
  day.** All 6 local capture nights carry `*_LINK.csv` with a `link_epoch` column, i.e. the connection
  boundaries, against a done-when asking for ≥ 5 nights. The item is unstarted, not blocked. I reached
  the wrong answer by searching for the *word* (`*sidecar*`, `*.jsonl`) instead of listing the
  directory's file types — the same shape as the `ppg_expected`/`ppg_offset` trap below. Caveat for
  whoever runs it: the Verity reconnects hard (243 and 327 connections on two nights), so the honest
  denominator is connections long enough to halve, not connections observed. Original reasoning kept: The assumption under test is in
  code (`pat-align.js:335`, the per-connection BLE offset being constant within a connection), and
  `patDipEvents` already consumes `opts.segments`. The local corpus has no connection boundaries.
  ⚠️ **`sessions` are not connections** — on 2026-08-14 there are 3 sessions and 3 Verity `_PPG.txt`
  files, which invites the substitution, but the first session spans **43 123 s (12 h)** and a single
  BLE link does not survive that here. Using sessions would measure stability *across* reconnects and
  report it as stability *within* a connection — inverting the gate's result.

**Plus `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` §1 CONFIRMED** — its "blocked, costs one night worn" note
was recorded 2026-08-04 and fourteen nights have been worn since; 35 of 45 local `OXYFRAME` files now
carry the columns. Measured over **162 576 frames**: `ppg_dur_step` 1 → median `ppg_n` **126**,
`ppg_dur_step` 2 → **127** (not ~252). So a `+2` step is one device-second with a skipped counter, read
off the declared count rather than inferred from arrival-stamp matching — §7.2's indirect recovery was
right. Also records that the shipped header has `ppg_offset`, not the `ppg_expected` §1 names.

**Plus `tools/pat-connection-stability.mjs` — the within-connection constancy measurement, built and
run.** `pat-align.js:335` asserts the per-connection BLE offset is constant within a connection, and
every dip event inherits it; nothing had measured it. Result: **n = 2, on one night — this corpus
cannot answer it yet.**

⚠️ **The first run's median |Δ| 110.3 ms over 9 connections was invalid and is retained only as the
reason the guard exists.** It gated on the *Verity's* spans while pooling H10 beats across the *H10's*
reconnects, so it measured an across-reconnect offset and would have reported it as within-connection
drift — the `sessions` error one device over. A PAT lag is ECG-to-PPG and inherits both links.

With the guard, only **8 of 113** Verity spans ≥300 s sit inside a single H10 connection, and 2 of
those carry ≥60 beats of both signals. So the real constraint is not "≥5 nights captured" but "≥5
nights with a long **simultaneous** connection on both devices" — scarce, since the Verity reconnects
16–327 times a night. The tool withholds its own p90 below n=10 and prints the shortfall instead:
at n=2 the p90 printed *below* the median and read as reassurance.

