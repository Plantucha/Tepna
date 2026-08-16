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

🔴 **A peer found the defect this tool exists to prevent, in this tool.** `IS_MAIN` tested
`process.argv[1].endsWith('doc-search.mjs')`. Copied to `doc-search-trial.mjs` to try it without
touching their tree, the suffix test went false, NEITHER branch ran, and it **exited 0 with empty
stdout and no diagnostic** — a fake "nothing found" from a tool whose only job is telling you whether
something was already decided. Renamed, symlinked, wrapped or vendored, it would have lied silently.

Entry detection now compares RESOLVED PATHS via an exported `isEntryPoint`, and a non-dispatch exits 2
with an explanation rather than 0 with nothing.

⚠️ **The first version of that control grepped this file for the old `endsWith('doc-search.mjs')` and
matched the COMMENT quoting it** — the substring-satisfiable assertion class `tools/gate-tightness.mjs`
exists to find, reproduced in the fix for another bug. Replaced with four behavioural assertions on
`isEntryPoint`, and verified by actually copying the file to another name and running it.

**Corpus extended to `papers/` and to `.html`** — a reference guide is a document even when it ships
as a page. Script and style bodies are dropped, so an inlined bundle cannot flood the index with
minified JS that matches every query weakly and nothing well. 20 selftests.

🔴 **RECALL@5 IS THE METRIC — top-1 must not be optimised**, and that is recorded in the tool because
the next person to improve it will reach for top-1. The costs are wildly asymmetric: a false negative
costs a session rebuilding finished work (a day of first-principles reasoning toward an answer two
briefs already held), a false positive costs opening one file. Any tuning that raises top-1 by
NARROWING the candidate set trades a cheap error for an expensive one and makes the tool worse while
the headline number improves.

⚠️ **The tool's worst outcome and its worst bug are the same shape** — "nothing found" — which is why
the dispatch guard exiting 0 with empty stdout was not an unrelated defect.

⚠️ **ADJACENCY IS NOT EQUIVALENCE.** A near-neighbour index systematically places the two
nearest-but-DISTINCT methods side by side. Real instance: a "two-line lag-1 autocorrelation" (a
correlation test) ranks adjacent to Riley & Greenhall lag-1 (a noise-type identifier) — same two
words, different statistic, different question. The reader opens the right file and draws the wrong
inference from its neighbour. A property of retrieval rather than a defect, and the one way a
path-ranking tool can still mislead; now stated in the output footer as well as the header.

Both findings are a peer session's, from using the tool on a live question rather than reviewing it.

🔴 **AND THE CORPUS ITSELF COULD BE EMPTY.** Pointed at a directory with no documents, this printed
its header, no hits, its footer, and **exited 0** — a fake "nothing found" from the tool whose worst
outcome is precisely that. Reachable with no error in the ranking at all: a wrong ROOT, an unreadable
directory, a copy vendored somewhere without the docs beside it. Found by applying a peer's structural
heuristic — *a pinned table should assert its own size regardless of what the assertion was added to
protect* — to this tool rather than agreeing with it.

⚠️ **A bare `length > 0` would have been the same defect one level up.** It detects only total loss,
which is the failure least likely to happen quietly; half a corpus silently missing would still pass.
So the check is for ANCHORS any correct checkout must contain — `CLAUDE.md` and `ORIENTATION.md` are
both required to sit in root, and a real brief set is never a handful. Absence means the corpus is
wrong, not that the answer is no. Refuses with **exit 2** and an explanation. 25 selftests, including
that a three-document corpus is refused where a `> 0` floor would pass it.

