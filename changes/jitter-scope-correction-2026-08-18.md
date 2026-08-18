---
bump: patch
type: fixed
brief: PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md
---

**Self-correction to #1489: "reproduces" was too strong for the jitter row.**

**What survives.** The tool was blind to 54 wrist files and now is not — that defect, and the
denominator/exit-2 fix, are independent of everything else. And `sdnnRobust` at **1.84 %** (14 nights,
100 % median match) is a direct measurement of what the shipped string claims, so **"no correction
owed" stands**, scoped to this corpus.

**What does not.** The 8.36 ms and my 6.09 ms are **not the same comparison.** The
`/VeritySense.*_PPG\.txt$/` pattern was in the **original** apparatus commit (`569c9804`, PR #756), not
added later, and the PSL tree contains **zero** matches for it. So 8.36 ms — reported over 15 nights
*with an IQR* — cannot have come from the PSL tree; it was measured on a corpus using capture-host
naming. Mine is from the PSL tree. **Two corpora**, so 6.09 does not refute 8.36 and #1489 should not
have implied it did. Whether 5.92 ms came from the PSL tree is likewise unestablished — and the
original §2.1 IQR (3.98–10.61) being far wider than mine (4.57–7.54) is itself evidence the runs saw
different data.

**Method check.** Ran without `--sleep-only`, then with it: byte-identical. A genuine no-op here, not an
inert flag — verified by control, since 10 of 54 wrist files *are* daytime and would be excluded, but
`--max-nights 15` selects by size and the 15 largest (320–377 MB) are all nocturnal while daytime files
median 14.7 MB.

**The lesson:** "reproduces" is a claim about two measurements of the *same thing*, and corpus identity
is part of the thing. I verified the method and the instrument, then asserted equivalence across an axis
I had not checked.

---

**AND THE LIKE-FOR-LIKE RUN IS NOW DONE — the bound worked, and it withdraws the rest of my claim.**

The baseline's corpus is named in the linked doc rather than the brief:
`docs/PPGDEX-FINGER-HRV-VALIDATION-2026-08-03.md` §4 — `/home/michal/tepna-smoketest/captures/`, still
on disk with 24 night dirs. Re-ran there with the documented flags, 11 nights:

| | recorded 2026-08-03 | same corpus now | PSL tree now |
|---|---|---|---|
| Verity PPI-jitter | 8.36 ms | **4.71 ms** (IQR 4.57–5.07) | 6.09 ms |
| `sdnnRobust` | +18.7 % | **5.89 %** (IQR −0.94–25.11) | 1.84 % |

**Not a discrepancy — the bound doing its job.** `ppgdex-dsp.js` has taken 22 commits since 2026-08-03,
including "the crystal axis ran backward" (#1229), which acts directly on beat timing. §5's rule is
*after ≤ before*: **4.71 < 8.36** on identical data.

🔴 **"The shipped `sdnnNote` string owes NOTHING" is withdrawn as stated.** `sdnnRobust` is **1.84 %** on
the PSL tree and **5.89 %** on the baseline corpus against a ~±3.5 % bar — it **passes on one and fails
on the other**, and the baseline IQR (−0.94 to 25.11) is too wide to call it stable there. The honest
position is this brief's original one: **corpus-dependent and unsettled.** The +18.7 % → 5.89 %
improvement is real; it is not the same as clearing the bar.

The tool fix (blind to 54 files; now prints its denominator) is independent of all of this and stands.

