<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
`selftest-all` now reports WHY a tool failed. It could not before, which is why two reproductions of a
failing selftest produced zero diagnostic information (FOLLOWUPS §3.4).

**The defect.** On failure the runner printed the tool's output lines containing `✗` or `FAILED` — the
signature of an ASSERTION failure — and discarded `err` entirely. A timeout, a crash, or any non-zero
exit whose output carries neither token therefore printed a bare `FAILED` and a **blank line**. Measured
on two independent `dsp-review-qwen.mjs` failures: both printed exactly that, while the tool passes
standalone (21 ok, 0 failed). The evidence was being thrown away at the moment of failure.

**The repair.** `whyFailed(err, timeoutMs)` names the exit status — `TIMED OUT after 120s (killed,
SIGTERM)` · `exited N` · `killed by SIGKILL` · a spawn error's first line — with `killed` tested before
`code`, because a killed process carries both and the order is load-bearing. `failureLines(out)` leads
with assertion lines when the tool printed any, otherwise shows the TAIL of whatever it did say, and
returns nothing when it said nothing so the caller can print `(no output at all — consistent with a
timeout or a kill before the tool printed)` rather than a blank line. 10 assertions pin both, and the
whole thing was verified against a PLANTED hanging tool, which now reports the timeout by name.

⚠️ **This is the instrument, NOT the fix for the qwen flake — that cause is still unknown.** What is
established: it is not an assertion failure (the blank-line signature), and the tool's selftest is pure
and hermetic. The index-contention mechanism this brief previously named is RULED OUT by reading the
call path (`docContext` fails soft by construction; the selftest never calls it; `pipelineBusy` takes
its input as an argument). The live hypothesis — a load-dependent timeout under `Promise.all` of 81
tools — is unconfirmed, and a third run under the same load passed. The 120 s timeout is deliberately
NOT tuned: that would treat a symptom whose cause has no name. The next occurrence will report why.
