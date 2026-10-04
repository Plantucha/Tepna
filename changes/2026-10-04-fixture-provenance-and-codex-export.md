---
bump: patch
type: added
brief: none
---

The capture-host test fixtures now say where their bytes came from: one registry classifies every test file that carries a timestamp, a long hex literal or a data fixture as captured, derived, format, synthetic or authored, and a test holds it equal to the tree. tools/codex-export.mjs builds the source-only export an external code reader may see, omitting the data and record trees and every captured or derived fixture, and refuses if any remain.
