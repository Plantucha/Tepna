---
bump: patch
type: changed
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

tools/oracle-ecg-firmware-rr.mjs adopts tepna.verdict/1: `verdictObject()` carries `scope: internal`, `--json` emits the object at the top level, and `--verdict-sample` emits the same shape over synthetic pooled input (no corpus, no DSP) so `verify:verdict-adoption` reads and validates it in CI; its manifest row flips to adopted.
