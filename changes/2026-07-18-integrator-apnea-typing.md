<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator, MotionDex]
brief: APNEA-TYPING-FUSION-2026-07-18-BRIEF.md
---
The Integrator types each desaturation obstructive-vs-central from MotionDex's chest-ACC respiratory-effort series (effort present through the event ⇒ obstructive, flat ⇒ central, no coverage or ambiguous ⇒ untyped — never guessed), exported as an additive experimental `summary.apneaTyping` split that leaves confirmedAHI untouched and is a silent no-op when MotionDex is absent.
