<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: TOOL-INVOCABILITY-SWEEP-2026-08-02-BRIEF.md
---
"40 shipped files the mutator cannot see" was never 40 files without tests. Audited and classified:

| | n | what it is |
|---|---|---|
| **mis-tagged** | **7** | groups already exercise them via `env.X`; the tag just didn't name the module |
| other harness | 4 | `verify-manifest` / `build-core-tests` / browser gates |
| DOM-bound | 28 | app / render / chart / analysis UI — the browser lane's job, not this tool's |
| **genuine gap** | **0** | `dex-contracts.js` is types-only: 126 lines of JSDoc `@typedef`, not inlined in any bundle, listed in `tsconfig.json`, checked by `tsc --checkJs`. No behaviour to mutate. |

**Counting is not classifying**, and the raw 40 invited exactly the wrong conclusion.

**The 7 tags were added mechanically, not hand-picked**: for each module, every group whose body references its `env` symbol had the module stem appended — 18 groups across `signal-adapters` (9), `signal-spec` (4), `cohort-gen` (3), `hrvdex-registry` (3), `cpapdex-registry` (3), `glucodex-registry` (2), `pat-gate` (1). Measurable files **71 → 78**.

Measured immediately, because a tag that selects the wrong groups is worse than no tag:

```
41 % signal-adapters · 50 % cpapdex-registry · 50 % glucodex-registry · 66 % signal-spec
66 % cohort-gen · 77 % hrvdex-registry · 83 % pat-gate        ──  50/81 = 61 %
```

Nothing catastrophic, and `pat-gate` — the promotion gate `ENGINE-VERIFICATION` §1.5 single-sourced — is among the strongest in the fleet.

Residue is now category C alone: 28 DOM-bound files whose coverage question belongs to the browser render lane.

Tests + brief — no shipped source, no `manifestHash` movement, no fixture re-recorded.
