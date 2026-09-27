<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [analysis]
brief: none
---
`Co-load §1b` had never classified anything bundled by the two **orchestrator** shells, because
`readSrcHtml()`'s list carried app shells only. Admitting them reds it with **17** unclassified modules
(not the 19 the residue row recorded — #3144 had already classified the two MotionDex ones), and the split
is mechanical:

- **six expose a named global** → ordinary RESOLVE entries: `night-seal.js` → `NightSeal`,
  `overdex-walk.js` → `OverDexWalk`, `signal-adapters.js` → `SignalAdapters`, `signal-orchestrate.js` →
  `SignalOrchestrate`, `signal-spec.js` → `SignalSpec`, `verdict.js` → `Verdict`. Each global was verified
  present in **both** lanes' `env` before the entry was written.
- **eleven vendor adapters expose no global at all** and self-register into `SignalAdapters`, so a RESOLVE
  entry has nothing to name. They are `RUNTIME_EXEMPT`, and each reason names the covering gate: `Co-load
  manifest §5` already asserts the manifest's adapter ids **equal** the ids registered via
  `SignalAdapters.list()` — an equality over the whole adapter set, strictly stronger than a per-file
  presence test.

With both shells in the population, the co-load order group's assertion returns to its two-family form:
the app carriers are exactly CLAUDE.md's `CLAIM clockBundles = 5`, and the orchestrators are their own
equality corroborating `CLAIM orchestrators = 2`. Their load order is now **asserted** rather than measured
by hand, which is what the previous comment promised to distinguish.

Measured before building: exactly **two** assertions red on admission, and the CSP and csp-strict gates —
expected to red on first contact — do not. Closes residue
`2026-09-27-orchestrator-shells-unclassified-by-coload`.
