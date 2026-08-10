<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PulseDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Bootstrap PulseDex compareIntervalSeries — 54 survivors, zero kills, the largest cluster in the file — and pin an inconsistency found while doing it.

The second function found with survivors but NO kills, after glucodex's genSynthetic. With nothing to
replay as a positive control the prober withholds every verdict, so all 54 were unclassifiable
regardless of the battery.

It earns a test on its own merits: this is the two-signal agreement path — the code deciding whether a
Verity armband and an H10 chest strap are measuring the same heart. CLAUDE.md §7 records H10↔Verity
sitting ~3.3 s apart on phone-captured nights, so the matcher's behaviour AS THE CLOCKS DRIFT is the
interesting case, not the happy path.

VERIFIED BY RE-APPLYING REAL SURVIVORS — 3 of 8 sampled now die:

  A.length < 5 && B.length < 5        KILLED     the ≥5 floor, now an OR not an AND
  j + 1 < A.length || …               KILLED     the two-pointer's advance condition
  for (i = 0; i <= m; i++)            KILLED     the 1:1 fallback bound

⚠️ THE SWEEP'S LINE NUMBERS WERE ALREADY STALE. #1127 moved pulsedex-dsp.js between the sweep and
this test, so applying the recorded survivors by line would have mutated the WRONG lines — exactly the
non-unique-anchor failure MUTATION-AUDIT-RUNBOOK documents. The verification re-anchored each survivor
by unique (op, before) first: 54 old survivors → 26 uniquely re-locatable, and only those were applied.
The 28 that could not be re-anchored unambiguously were skipped rather than guessed.

⚠️ AND AN INCONSISTENCY IS NOW PINNED AS BEHAVIOUR: a length-mismatched `tsMs` matches ZERO of 200
beats while still reporting `haveAbs: true`. Two decisions use different criteria — `haveAbs` is true
whenever both sides merely HAVE a tsMs with a finite [0], but `endTs` independently falls back to a
cumulative axis when `tsMs.length !== vals.length`. So one side sits on a cumulative axis from 0 while
the other stays on absolute wall-clock ms, nothing can come within tolerance, and the result is a
confident "0 matched" rather than a refusal. Asserted so it cannot change unnoticed; whether `haveAbs`
should agree with `endTs` is the node owner's call, not this test's.

24 assertions, every expectation measured against the implementation before being written: the
identity case (200/200, bias 0, r 1, grade ok), the drift case (a 12 ms per-beat stretch loses matches
as the clocks separate — 126 of 200), the no-timestamp 1:1 fallback, the ≥5 floor from both sides, and
the three refusal paths.
