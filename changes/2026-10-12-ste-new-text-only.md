---
bump: minor
type: changed
brief: none
---

**The writing rules bind each new Markdown file, and the linter stops flagging about 4,300 false findings.**

`tools/pr-compliance.mjs` has a seventh check. Each Markdown file that a PR adds must pass `tools/ste-lint.mjs`. An edit to an old file does not make the old file binding. The failure names the file, the line and the rule.

`tools/ste-lint.mjs` no longer reads an adjective as a passive verb or a noun as a verb-noun. "is green", "is open" and "is unchanged" are states. "the ceiling" and "the sibling" are nouns. A hard-wrapped line that stops at "the existing" goes on to its noun on the next line.

The linter now joins the lines of a paragraph before it counts sentences. Before, a hard-wrapped sentence counted once per line. The linter also skips YAML frontmatter, such as a skill's `description:` line. Each fix has its own self-test case, and a real finding still reports.

| population | before | after |
|---|---|---|
| findings over the 767 tracked Markdown files | 15,649 | 11,302 |
| passive | 7,545 | 6,892 |
| long paragraph | 3,586 | 140 |
| verb-noun | 414 | 182 |

Owner ruling 2026-10-12: the rules bind new text, and old text stays as it is. The owner gave the purpose: the text must be easier for an LLM to process.
The owner also searches the repo with bge-m3 and XERJ. One approved term per thing helps the word match, and a short paragraph about one topic helps the embedding match.
