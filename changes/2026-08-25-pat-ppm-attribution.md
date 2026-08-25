---
bump: patch
type: changed
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---

Run §3f.4's parked per-window ppm test (§3f.5): differential clock drift moves the PAT offset by a
median 76 ms over a 120-min window against the ~450 ms identifiability band — 0 of 22 windows come
close — and |dppm| does not separate coupling windows from null ones (medians 10.47 vs 10.65). The
steady-crystal explanation for the intermittency is eliminated; a stalled link is not.
