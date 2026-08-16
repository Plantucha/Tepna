---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

Semantic search over the 470 briefs, audits, specs and root docs — for the question CLAUDE.md keeps
recording as a failure: **has this already been decided?** Four sessions once proposed a fix the repo
had measured futile; five reviewers falsified in minutes a paragraph nobody had queried. `grep` only
works if you already know the vocabulary the decision was written in, and you don't — that is why you
are searching.

**Measured instance that prompted it:** a week of hand-writing equivalent-mutant proofs for
`clock.js`, while `briefs/MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md` had already measured that file's
ceiling (81.9 % raw / 100 % distinguishable) and had it owner-ratified. A semantic query returns it at
**rank 1, score 0.688**. No grep run that week would have: the search terms were "TCE" and
"equivalence"; the brief is titled after the *denominator*.

**Why this use of a local model when two others measured useless.** The same model produced ZERO
confirmed findings across two GENERATION tasks — ranking assertion strength (0 of 3 flags real, and it
missed the known-weak control) and auditing code against the deep-audit charter (7 prompt variants,
every substantive claim false, including one that three variants agreed on). Retrieval inverts the
economics: the output is a PATH, the failure mode is a wasted read, and verification is opening the
file.

🔴 **It therefore never answers a question — it ranks paths.** The moment it summarises what a brief
says, it is back in the failure mode above, with a plausible summary of a document the reader then
does not open.

⚠️ **Fails soft.** Embedder unreachable ⇒ deterministic token search rather than an error, because a
search tool that is down is a search tool nobody uses.

Chunked (1200/900 overlap), because whole-file indexing finds TOPICS and the thing you want is a
PASSAGE — measured: top-1 1/5 → 2/5, and one query moved rank 42 → 20. Incremental by content hash:
cold build 201 s, warm query **1 s**. Honest limits: top-5 4/5 and top-1 2/5 on five known answers, so
it is a read-the-top-five tool, not an oracle. 12 selftests.
