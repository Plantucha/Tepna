---
bump: minor
type: added
brief: GENERATED-OUT-OF-PRS-2026-10-20-BRIEF.md
---

The PR walker builds `origin/main` in its own checkout once for each new main commit. When a build output differs from the committed bytes, the walker opens one draft PR that carries only those paths. The branch starts with `claude/regen-walker-` and the title starts with `regen:`. The walker keeps one regeneration PR in flight, and a dirty path outside the build outputs stops the pass. `commit-shape.mjs` exempts the `regen:` subject. This is stage 3 of the plan to take generated files out of pull requests.
