---
bump: patch
type: changed
nodes: [docs]
brief: none
---

**The files that every session reads at start now pass the writing rules.**

`ORIENTATION.md`, `README.md`, `CONTRIBUTING.md`, `DOCS-INDEX.md` and the fourteen `.claude/skills/*/SKILL.md` files had 56 findings under the linter from the previous STE change. They now have 0. The rewrites change voice and sentence length only. They keep each fact, number, owner quote and field name.

One `DOCS-INDEX.md` table row had no leading `| [` and rendered as a paragraph. The row now renders in the table.

The owner gave the purpose: STE must make the text easier for an LLM to process. Every session reads these files first, so these files give the most return per edit. `CLAUDE.md` stays as it is, because a change to it is the owner's decision.
