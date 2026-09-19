---
bump: minor
type: added
brief: QWEN-ENGINEERING-PROGRAM-2026-08-27-BRIEF.md
---

`tools/verify-draft-kills.mjs` — verifies that a drafted assertion, as written, actually kills its
mutant. The drafting pipeline's headline guarantee was enforced against probe-time recordings rather
than the rendered artifact; measured over all 376 drafts, 6 do not kill and only 74 can be checked at
all, because mutant identity is stored as a line number that rots.
