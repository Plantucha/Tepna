<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
`selftest-all` prints per-tool wall time, and the machine's load average at sweep start and at every
kill. **An instrument, not a fix** — §3.4's cause is still not established.

The reporter shipped in #2089 named the CLASS of the `dsp-review-qwen` flake on its first run (a
timeout, never an assertion failure). Explaining WHY has now cost two withdrawn mechanisms — index
contention (ruled out by the call path) and sweep-vs-shard contention (ruled out because `npm run check`
is a sequential `&&` chain where `test:tools` runs BEFORE `test:par`, and because an uncensored
reproduction under deliberately-induced shard load put the tool at **6.3 s**, against its 3.6 s
standalone and a 120 s timeout).

**No pool is shipped.** Bounding this runner's own concurrency would have been a fix for a constraint
the measurement says was not binding — a third mechanism, dressed as code.

What ships is what makes the surviving hypothesis falsifiable. §3.4's remaining candidate is
CROSS-SESSION load: several fleet sessions running full gates on one box, invisible from inside any one
of them. So the reporter now prints:

- **per-tool wall time** for anything ≥1 s — `[3.6 s]` beside `dsp-review-qwen`, `[4.0 s]` beside
  `mutation-crawl`, `[1.3 s]` beside `nsrr-stage-validate`, and nothing beside the other 78. That keeps
  the standing prediction testable on EVERY run rather than only when something dies: if a ≤0.3 s tool
  ever times out, the CPU-demand account is refuted.
- **`os.loadavg()[0]` at sweep start and again AT EACH KILL** — sampled at the kill, not at the end,
  because by the time a sweep finishes the spike that killed a tool is gone and an average taken then
  describes a different machine. A kill at LOW load refutes the cross-session account outright; a kill at
  high load with no other fleet gate running refutes it differently.

Verified both ways: a normal run prints `load average at sweep start: 2.20 (24 cores)` with the three
wall times, and a planted hanging tool prints
`✗ tools/_probe-hang.mjs FAILED — TIMED OUT after 4s (killed, SIGTERM) [4.0 s] [load 2.33 at the kill, 2.27 at start]`.
The timeout is untouched; the probe used a temporary local value and was reverted from a copy.
