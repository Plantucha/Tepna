---
bump: patch
type: changed
brief: PAT-RELATIVE-REFRAME-2026-08-17-BRIEF.md
---

The within-connection offset stability box is **answered**: 14 nights, 31 connections, against a
done-when asking for ≥ 5 nights.

**No new machinery.** `tools/pat-connection-stability.mjs` already existed; every prior run pointed it at
`uploads/captures` (6 nights, n = 2, an honest *"this corpus cannot answer it yet"*). The capture-host
corpus carries **440 `*_LINK.csv` sidecars across 40 nights**. Same tool, same flags:

```
node tools/pat-connection-stability.mjs /home/michal/tepna-smoketest/captures --min-span-sec 300 --min-beats 60
```

**POOLED n = 31 · median |Δ| 43.8 ms · p90 142.9 ms · max 815.6 ms** — past the tool's own n ≥ 10
threshold, so the p90 is published rather than withheld.

🔴 **The answer: `pat-align.js:335`'s constancy assumption holds at the median and fails for ~1
connection in 4.** It claims *"the ~2.2 s per-connection BLE offset is CONSTANT within a connection — a
within-connection difference cancels it exactly."* Against the ±90 ms PAT tolerance: the median
connection drifts **43.8 ms** (sound), but **8 of 31 (26 %) exceed ±90 ms**, p90 is **142.9 ms**, and the
worst is **815.6 ms** — most of an RR. The difference does not cancel *exactly*, and "exactly" is the
word doing the work. The dip path's one-clock gate needs a per-connection drift check, or a bound quoted
with its failure rate.

⚠️ **Why it stayed closed for nine days** — and it is not the vocabulary trap the brief already records
(*a grep for the word you expect returns empty against data present under another name*). This is the
sibling: **the right name, searched in the wrong corpus.** `*_LINK.csv` was found correctly in
`uploads/captures`; nobody asked whether a larger corpus held the same sidecars. **A negative that is
really a sampling limit should name the corpus it sampled** — this one did, which is exactly why
re-reading it surfaced the gap.
