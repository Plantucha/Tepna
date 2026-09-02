<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [tooling]
brief: ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md
---
Two gates for two defect classes this repo keeps finding by hand and re-finding later. Both were
**measured before they were written**, both are **ratcheted rather than pass/fail** (a gate red on day
one gets switched off, taking the real finding with it), and both are **shown to fire on the actual
historical defect** rather than only to pass.

**1 · `source-visibility` — a layer nothing reads is a layer nothing checks.** Every text-reading
assertion can only see files that reached `env.sources` or `SOURCE_FILES`; whatever is in neither is
unscannable *by construction*. That is not hypothetical: `pat-feasibility.js` sat outside both lists
while its WORKER was inside them 5 times, which is exactly how a published `vdCorr` reached no surface
with the suite green (#2117). And the prior audit that found the same hole recorded it **in this very
test file** — *"ecgdex/ppgdex-render.js were not 'classified', they were INVISIBLE"* — and those files
are still outside both lists, because a comment does not fail when the defect recurs. **13 of 112**
root runtime `*.js` are invisible today: the un-bundled tail (cohort tooling, `dex-coload.js`,
`dex-contracts.js`, provenance surfaces, standalone analyses). Ratchet proved by planting a real
un-wired root module — 13 → 14, gate red; removed, green.

⚠️ **The registries and spine are NOT in that set, and an earlier draft of this measurement said they
were.** `readSources()` also walks every bundle and pulls each `data-inline-src`, so anything inlined
into an app is readable for free — the hand-written array is 77 of the 131 entries actually assembled.
Scraping the literal gave **38 of 112 including all eight `*-registry.js`**, an alarming figure that
was wrong. **The gate caught its own author on its first run**, refusing `INVISIBLE_CAP = 38` with
*"only 13 invisible now"*. A list in source is a claim about a list; the assembled object is the fact.

**2 · `dead-cross-boundary` — computed, carried, never consumed.** A value crosses a worker boundary
and nothing reads it: the producer is correct, the payload is correct, every test passes, and the
number reaches no surface. Verified to fire on the real thing — against the pre-#2117 renderer it
reports `["vdCorr"]`, against today's `[]`.

**It found a live one on its first run.** `pat-feasibility-worker.js:513` emits
`out.detailCorr = pack(cpCorr)`, and `detailCorr` appears exactly ONCE in the whole repo — its own
assignment. Same class as `vdCorr`, same file, and it survived that hand fix hours earlier. Not
auto-fixed, because surfacing it is a UI decision and inventing that surface would consume a design
call the way promoting the tier would have in #2117; declared known-dead with the ratchet at one and
rowed as **R15**. (**R12**, filed independently the same day in another family, is a third instance of
this class.) Scoped to DECLARED producer/consumer pairs — an automatic boundary-finder would
false-positive on every object literal in the repo.

⚠️ A draft of this change also added `pat-gate.js` to the Node source list, on the grounds that the
gate cannot judge a key unread without the consumer's text. **It was already there** — the same
partial-regex extraction that produced the wrong 38 also told me it was absent, so one broken
instrument yielded both an inflated count and a redundant edit justified by a false premise. Removed.
