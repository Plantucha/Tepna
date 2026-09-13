---
bump: patch
type: added
nodes: [suite]
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

`tools/nsrr-fetch.sh` — fetch an NSRR signal set in N parallel streams. Resumable, idempotent, safe to
re-run.

⚠️ Nothing in the suite calls it, and nothing ever will. Tepna never fetches — no bundle, no gate, no
CI job reaches the network, enforced by `no-network.html`. Obtaining a corpus is the owner's act,
performed deliberately outside the repo's execution paths. This script exists so that act is
reproducible and documented rather than reconstructed from shell history, and it needs a token the
repo does not hold.

**Why parallel, measured rather than assumed.** NSRR throttles per connection, not per account. In a
paired test over equal windows, one stream ran 0.67 MB/s while three ran 1.47 MB/s aggregate — and the
original stream did *not* degrade, which is the load-bearing observation. Sequential download of
SHHS1's 5136 EDFs projected ~40 hours; at 16 streams the same corpus was 56 % complete in under two
hours.

⚠️ The multiplier is NOT a constant and the script says so. NSRR's rate varies by 2.5× over time — the
same 8-stream configuration measured 3.27 MB/s and 8.37 MB/s an hour apart. Any ETA is what the
current rate implies, never a forecast.

N defaults to 4. Sixteen is what was used here and is already impolite enough on someone else's
DUA-gated servers; the script documents that rather than encouraging more.

Resumability is the property that matters most: every worker skips ids already on disk, so an
interrupted run continues, a re-run costs nothing, and a corpus copied in from elsewhere is simply not
re-fetched. That was exercised repeatedly — including one occasion when a careless `pkill -f` stalled
every worker and the restart lost nothing.
