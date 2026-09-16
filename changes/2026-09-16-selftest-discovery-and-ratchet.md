---
bump: patch
type: fixed
brief: TOOL-BUILD-STANDARD-2026-09-13-BRIEF.md
---

tools: `selftest-all` discovered selftests by matching three hard-coded call spellings, so a fourth
read as no selftest at all — four tools were never run locally. Discovery now keys on call position
(100 → 104 tools, none lost), and a ratchet requires any NEW tool to print a parseable assertion
count, so the standard is enforced rather than reviewed.
