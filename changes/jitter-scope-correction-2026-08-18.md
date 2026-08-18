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
