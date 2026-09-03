<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: AS11-SESSION-DETECTOR-IMPLEMENTATION-2026-08-24-BRIEF.md
---
capture-host: the AS11 session detector's READ-ONLY property is now enforced rather than asserted in a comment — a source scan across all three detector modules forbids `Set…`/`Enter…` protocol verbs, stripping comments while keeping string literals because an AS11 operation is a method string, not a Python attribute.
