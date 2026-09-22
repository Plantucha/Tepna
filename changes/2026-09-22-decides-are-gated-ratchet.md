---
bump: minor
type: added
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

Every `decides` producer in tools/verdict-adoption.json must be GATED — a `--selftest` in call position, or a file under tests/ or capture-host/tests/ naming it — a static population equality checked by `verdict-adoption --check` (npm run check · CI static), ratcheted by UNGATED_RATCHET (four band-less analysis tools today; may only shrink). A check with no test now reds by name the day it is binned; a ratchet entry that gains a test reds until removed; a test that disappears reds. Its first catch: pletha-marker-oracle's selftest was spelled `arg === '--selftest'`, invisible to selftest-all's discovery, so it never ran in the sweep — now it does. Closes residue 2026-09-12-fix-for-ungated-check-lands-ungated (the sibling row's measurement rules the diff rule out; this is the static form).
