---
bump: patch
type: fixed
brief: none
---

`tools/ai-probe-overnight.sh` — **one half of the tool refused loudly while the other half proceeded
silently.** The probe's canary refuses a file when *"the source moved since the crawl, so recorded
lines no longer address this code"*; the draft step then consumed that same stale data anyway.

Measured on the 2026-08-24 09:31 run — the first after a merge wave rewrote four DSPs:

- **32 canary refusals** (4 files × 8 passes): cpapdex, motiondex, ppgdex, oxydex.
- `cpapdex` drafted **0 of 49**, `motiondex` **0 of 13** — not model quality, but drafts attempted
  against recordings that no longer describe the source.
- 🔴 **`oxydex` refused too, yet produced 24 assertions** — because it still had a **day-old**
  `ai-probe.json` (08-23 02:15, against today's 08-24 09:37 for healthy files). Its output looked
  like the run's best result and was the least trustworthy thing in it. **Those 24 drafts must not be
  adopted until its crawl is refreshed.**

The draft step now gates on the probe's **own exit code** (`rc == 2`, already documented in this
script as "a canary refusal … a per-file verdict"), so no output parsing is involved. Skipped files
are named loudly and counted, and the count is reported at the end — a partial fleet must not read as
a whole one.

⚠️ **The `| tail -4` is also gone**, and this is the same truncation whose exit-code half was fixed
on 2026-08-23 **in this very line**. The per-candidate rejection reasons are the only field that
distinguishes a weak model from a broken harness, and the tail discarded every one of them — which is
why the 0-of-49 could not be diagnosed from the log it had just written.

Verified by re-application over three controls: a refusing file is skipped while its siblings still
draft; a file that recovers on a later pass drafts again (last verdict wins); all-refusing yields zero
drafts with an accurate count.
