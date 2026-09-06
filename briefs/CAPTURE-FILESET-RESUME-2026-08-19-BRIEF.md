<!--
  CAPTURE-FILESET-RESUME-2026-08-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-09-03 (core shipped #1532. Every acceptance item is now verified by RUN, not by assertion: box 3 field-measured 2026-09-02 on vigil (Verity median 2 sets/night, range 1–3, n = 14, against a pre-feature baseline of 15); boxes 2 and 4 closed 2026-09-03 by the §3.1 coverage-equality test and its span-sensitivity control (#2134); box 1 closed 2026-09-03 — its "gap row" clause names the O2Ring grid's mechanism, and the ring never resumes, while the resuming Polar path shows the outage as a real discontinuity on the anchored `timestamp [ms]` axis, already pinned by `test_resumed_ecg_keeps_its_relative_ms_anchor`. The 2026-08-26 DONE was PREMATURE rather than wrong and was reopened 2026-09-02; this one is earned) · **Created:** 2026-08-19 · **Residue:** 2026-09-06-ring-fileset-never-resumes · **Follows:** `VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md` (§P2.2 — the one P2 item its 2026-08-19 verification left open)

# Resume the file-set on reconnect — the last open P2 item, remeasured before proposing

> **Scope:** `capture-host/` only — no Dex bundle, `manifestHash`, or provenance impact.
> **Gate:** `capture-host/check.sh` (ruff · shellcheck · pytest `--cov --cov-branch --cov-fail-under=100`).

## 1 · The problem, measured 2026-08-19 (not inherited from the July night)

P2.2 was written off one bad night (189 O2Ring sets under a wedged adapter). The full corpus says it is
the **steady state**, not the bad night:

| device | nights | sets/night median | p90 | max | total sets |
|---|---|---|---|---|---|
| Polar H10 | 25 | 6 | 34 | 45 | 291 |
| Polar Verity Sense | 25 | **15** | **238** | 347 | 1,487 |
| Wellue O2Ring-S | 26 | 10 | 28 | 64 | 376 |

**2,154 file-sets where 76 (one per device-night) would be ideal — 28.3× fragmentation**, ~10,000 excess
files at ~5 streams/set.

⚠ **The dominant driver is no longer the flapping link P2.2 named — it is the `drop_not_worn` duty
cycle.** A doffed Verity is dropped after 180 s, rechecked every 90 s, and every recheck-reconnect mints a
full new file-set. That machinery is *correct* (it ended the streaming-into-a-desk defect) and its cadence
sits **inside** the resume window below, so resume collapses exactly the churn it generates. Any design
that only handles link flaps misses the majority case.

## 2 · Design (P2.2's sketch, confirmed against today's code)

- **Resume, same device + same night, when the gap < `resume_window_sec` (default 300).** The PPG grid
  writer already inserts honest gap rows — a reconnect is just a larger gap. Reopen the *existing*
  file-set in append mode and write a gap row spanning the outage.
- **A true outage (≥ window) starts a fresh set — that boundary is correct and stays.** The 37/75-minute
  wedges of 2026-07-23 should still fragment; that fragmentation is *information*.
- **`link_epoch` still increments per reconnect** (E5) — resume must not hide relinks from the LINK
  sidecar; it changes only where the *samples* land.
- **The session stamp in the filename stays the set's FIRST connect** — a resumed set keeps its name, so
  every name-keyed consumer (trio-batch, the regen tools, QC) sees one set where it saw many.

## 3 · What must NOT regress (each is a test, not a hope)

1. **Gap accounting** — nightqc coverage on a resumed set must equal coverage over the fragments it
   replaces (same denominator, same holes). Plant a synthetic reconnect; assert equality.
2. **Clock Contract** — the resumed writer must not re-anchor `t0Ms`; stamps continue on the same axis.
   §2.6: the gap row is *visible absence*, never interpolation.
3. **Sidecars** — PMDARRIVAL/LINK rows keep flowing per connection; only the payload files merge.
4. **The duty-cycle interaction** — a doff→recheck→reconnect cycle (90 s cadence) must resume, and the
   doff-pull trigger (`notworn_pull_due`, #1473) must still fire on the *drop*, unaffected by where
   samples land afterwards.
5. **Mid-set crash** — a resume onto a file whose last write was torn must not corrupt the set; append
   after validating the tail or start fresh with the outage recorded.

## 4 · Explicitly out of scope

- Retroactive merging of the existing 2,154 sets (the analysis tools already walk multi-set nights).
- Any change to `drop_not_worn` itself — its 91-events/7-days behaviour is measured and wanted.

## Done when

- [x] A planted reconnect inside the window lands in the SAME file-set with a gap row; outside the window
      starts a fresh set. Both directions tested. **CLOSED 2026-09-03, and the clause's wording is
      corrected rather than satisfied literally.** Window directions: tested
      (`test_resumable_stamp_finds_the_set_inside_the_window` + the outside-window `is None` case).
      Append: `test_stream_writer_resumes_without_a_second_header`. The **gap row**:
      `test_resumed_ecg_keeps_its_relative_ms_anchor` already pins it — a reopened writer recovers
      `_first_ns`, so a 3-minute outage appears as `rel = 180_000.0` in the `timestamp [ms]` column, a
      real discontinuity on an axis anchored to the ORIGINAL first sample. That IS §2.6's *visible
      absence*, and it is better than the clause asks for.
      ⚠️ **Why this read as untested for two weeks: the clause names a mechanism from the wrong
      device.** "Gap row" comes from §2's justification, which cites the O2Ring PPG grid writer — and
      the ring never resumes: `resumable_stamp` is called in `run_polar` alone, and `O2PpgGrid` is
      rebuilt per session by design (`capture.py:3412`) precisely because a ring reconnect opens a new
      file. The ring needs an inserted marker because its sample clock is SYNTHESIZED; Polar rows carry
      real device and phone timestamps, so their gap is arithmetic in the data. Writing a literal gap
      row on the resuming path would invent a row the file does not need, against `writers.py:13`
      ("a gap in capture is a GAP in the file … never invented rows"). Same shape as O2RING-TIME-
      CAPABILITY 2c: an acceptance item that names an identifier instead of the capability, and so
      cannot be satisfied by the thing that already satisfies it.
- [x] nightqc coverage is byte-equal between a resumed night and its fragmented twin (planted).
      **CLOSED 2026-09-03** — `test_a_resumed_set_and_its_fragmented_twin_score_the_SAME_coverage`
      (`tests/test_nightqc.py`): two night dirs describing the same real night, one resumed across a
      120 s reconnect and one fragmented into the two files the pre-resume writer would have produced,
      same rows and same wall-clock extent. Both score identically. Paired with
      `test_the_equality_is_SENSITIVE_to_the_span_it_asserts`, which separates the fragments beyond
      `_SESSION_GAP_SEC` and requires the coverage to DIFFER — without it the equality would pass
      against a span-blind `summarize` and prove nothing. Verified by shrinking `_SESSION_GAP_SEC` to
      60 s so the fragments no longer merge: the equality leg goes red, i.e. it measures the merging it
      asserts.
- [x] A real Verity duty-cycle night captures as **2 sets (median; range 1–3, n = 14 nights)**, measured on
      vigil 2026-09-02 by counting distinct 14-digit set stamps per device per night, against the pre-feature
      baseline of median 15. ⚠️ The item as written asked for “~1 set” and the measured answer is **2** —
      recorded as measured rather than rounded to the target, because a night with a genuine long gap SHOULD
      mint a fresh set: that is §2's window rule working, not a shortfall. 2 is the honest number and the
      better target.
- [x] `check.sh` green at 100 % branch coverage; every §3 invariant has its own test. **CLOSED
      2026-09-03** — it failed only on §3.1, which the box above now covers; §3.2's no-re-anchor
      invariant was already tested (`test_resumed_ecg_keeps_its_relative_ms_anchor`) and the 100 %
      floor is real and CI-enforced.
