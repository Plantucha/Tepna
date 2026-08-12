<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
`land-pr` reported its most severe verdict for its most transient cause.

Measured 2026-08-12 on #1183. A `net/http: TLS handshake timeout` from the GraphQL API made
`gh pr checks` throw. The snapshot fell back to an empty check list — indistinguishable from "no run
exists" — so the missing-required-context rule fired and printed `stuck: required check never
reported: test, no-network, typecheck, biome, test (py3.12), test (py3.13), browser-gates`. The PR was
green throughout and merged four minutes later on a plain re-run.

`stuck` is the ONE verdict that means waiting cannot help. Waiting was exactly the right response.

A snapshot now carries `readable`, set false only when the checks call threw, and `decide()` resolves
an unreadable snapshot to `wait` BEFORE the missing-context rule. The asymmetry is deliberate: a
spurious `wait` costs one more poll, a spurious `stuck` abandons a landable PR.

Four assertions in the `land-pr` group, including the two that keep the fix from disabling what it
guards — a READABLE snapshot with a genuinely absent required context must still be `stuck`, and a
snapshot with no `readable` key at all is treated as readable rather than unknown.

Same family as the rest of this session's findings: an absence read as evidence when it was really a
failed measurement.
