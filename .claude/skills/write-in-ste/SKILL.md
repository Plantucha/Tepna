---
name: write-in-ste
description: Use when writing text that another person or session reads, from a PR body to a brief or a message. The ASD-STE100 structure rules as this repo applies them, the linter, and the traps it measured. Use before you send, and again after the linter reports.
---

# Write in STE

The rules come from ASD-STE100, Issue 8 (2021). This repo adopts the rules, not the dictionary.
The approved words are ours, in `docs/GLOSSARY.md`.

`tools/ste-lint.mjs` checks every rule below and exits 1 on a finding. `tools/pr-compliance.mjs`
runs it over every PR body (owner, 2026-10-12, "make it bite").

## Structure rules

1. One idea per sentence. A sentence has a verb.
2. A sentence in a procedure has at most 20 words. A sentence in a description has at most 25.
   An imperative sentence is a procedure wherever it stands.
3. A paragraph has at most six sentences. A blank line ends a paragraph. A list item is its own paragraph.
4. Use the active voice and name the actor. Write `the walker undrafts the PR`, never `the PR is undrafted`.
5. Use a verb as a verb. Write `measure the span`, never `the measuring of the span`.
6. One instruction per sentence. Two imperatives joined by "and" are two sentences.
7. Use the approved term from `docs/GLOSSARY.md`. The linter names the retired term and its replacement.
8. Parallel items go in a list. Numbers go in a table, with the population and the window beside them.
9. A procedure is a numbered list. A description is prose. Do not mix them in one paragraph.
10. A technical name keeps its form. `oxydex-dsp.js`, `manifestHash` and `OxyDex` are not -ing nouns.

## Run the linter

```sh
node tools/ste-lint.mjs <file.md>; echo EXIT=$?     # the exit code is the verdict
node tools/ste-lint.mjs - < body.md                 # a PR body on stdin
node tools/ste-lint.mjs <file.md> --json            # the verdict object alone
node tools/ste-lint.mjs <file.md> --advisory        # report only, for a backlog sweep
```

Capture the exit code before any pipe (`CLAUDE.md` §4b). Fix every finding. Run it again.
The linter skips fenced code, tables, quoted log lines, headings, inline code, URLs, citations, the
`Rule 0:` line and the `Fleet-Session:` trailer. Those spans are evidence or labels, not prose.

## Measured

- A period inside bold joins two sentences: `**Fixed.** The gate` reads as one sentence. Put the
  period outside the bold (Heron and Magpie, 2026-10-12).
- Twenty items joined by " · " on one line are one sentence of 133 words. A numbered list, one item
  per line, passes (the board's projected-commits section, 2026-10-12).
- A hard-wrapped paragraph counts one sentence per line, so a six-line paragraph reads as seven
  sentences. Keep a paragraph under six sentences, not under six lines.
- Read the exit code, not the printed count. Before #3483 the tool printed `NOT_APPLICABLE` over a
  body with 21 findings, and five of ten open bodies went red when the rule began to bite.
- The glossary reader read single-name rows only, so 2 of 30 technical names registered. A technical
  name flagged as an -ing noun is that defect, fixed in #3483.
- Six of eight open PR bodies carried findings, from 5 to 21 each, on the day the gate turned strict.
  A body edit alone does not re-run the gate; push an empty commit after the fix.

Memory: `ste-writing-rules-bite`, `query-state-never-memory`.
