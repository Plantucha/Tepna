---
bump: patch
type: fixed
brief: EXPORT-HARDENING-FOLLOWUP-BRIEF.md
---

Closes `EXPORT-HARDENING-FOLLOWUP`. §6 executed — the four remaining JSON blob types gain
`;charset=utf-8;` (`motiondex-app.js`, `pat-feasibility.js`, and the two analysis tools), matching what
the CSV pass already did. The MotionDex re-bundle is export-inert by computation: `manifestHash`
696d1d47931d → 29c4bf42d7ae with `computeHash` unchanged at 73f4f271f032. Every other item re-verified in
source: §1's `Date.now()` fabrication is gone, §3's flaky leg now records an environmental SKIP, §5
rounds, §7 was already deleted.
