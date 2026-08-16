---
bump: patch
type: fixed
brief: KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md
---

The known-clock experiment's results table marked target 1 — constant offset — as passing its
preregistered criterion of `Δppm < 0.5`. That criterion cannot fail.

`clock.js:492` is `var r0 = pts[0].r`: divergence is measured relative to the first anchor, so a
constant offset shifts every residual by the same amount and is subtracted out exactly. Measured
against the real `DexClock.hostAxis` on 200 anchors carrying a genuine +100 ppm error, injected offsets
of 5 000 ms, −250 000 ms and 1 000 000 ms all recover −100.716809 ppm, differing from the unshifted run
by 10⁻¹⁴ to 10⁻¹³. A sixteen-minute offset passes as comfortably as five seconds.

So the ✅ carried no information about the estimator, and a reader scanning the table counted six passes
and one failure. The row is now ⊘ — neither pass nor fail — with the measurement recorded beneath it.

The brief already contained the correction and contradicted itself: §2.3 predicted target 1 was not
identifiable this way, and the Done-when box "Target 1 is evaluated on an aperiodic marker" is
unchecked. The ✅ is what a reader met first.

This matters more here than it would elsewhere. The whole method is preregistered criteria, and its
value rests on a criterion being able to fail; one that cannot is worse than none, because it launders
"not measured" into "measured and passed". Targets 6–8 have not been run, so the check that would catch
the next instance is free right now and cannot be retrofitted afterwards: for each criterion, ask what
injected value would make it fail, and if the answer is none, it is measuring the estimator's
construction rather than its behaviour.

Also corrects the Done-when list, which read as seven untested items when two were done and one had
been tested and falsified. The `acceptance.json` box is verified — the file is tracked, was committed
in #1252, and its sha256 matches the hash recorded in the brief byte for byte, so the preregistration is
real rather than asserted. The O2Ring box is marked falsified rather than left blank: it did not refuse,
returning `ok:true` and a confident 2765.5 ppm for a device with no oscillator, which is Defect A. A
preregistered prediction that fails is the experiment working, and an unticked box read as though it had
never been run. The three remaining open boxes are annotated as correctly open, each naming the unrun
phase it waits on.

Docs only.
