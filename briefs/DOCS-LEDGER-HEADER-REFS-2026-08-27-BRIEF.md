<!--
  DOCS-LEDGER-HEADER-REFS-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-27 (built as `docs-ledger` **check7** + 4 self-tests; the scope argument in §3/§5 is **corrected below** — prose lives ON the Status line, not only below it, and the §3 count is unreproducible) · **Created:** 2026-08-27 · **Affects:** the `docs-ledger` group in `tests/dex-tests.js`

# A brief name in BACKTICKS on a header line is checked by nothing

## 1 · The hole

`docs-ledger` already refuses a dead **relative link** in `DOCS-INDEX.md` — `](briefs/…)` resolves
against the real brief set. But a brief's own header names its neighbours in **backticks, not links**:

```
**Status:** IN-PROGRESS · **Executes:** `SOME-CHARTER-2026-08-26-BRIEF.md` · **Extends:** `OTHER-BRIEF.md`
```

Nothing resolves those. A header may cite a brief that was never merged, was renamed, or never
existed, and every gate stays green — the reference is prose to every checker in the repo.

## 2 · How it surfaced, and why that is worth recording

2026-08-27, ~04:10: PR #1837 (an owner-issued charter) went DIRTY against an adjacent `DOCS-INDEX`
row and was closed; its branch was deleted. The charter was reissued as #1840 — **but for the window
between those two events, `briefs/O2RING-AUTONOMOUS-HARVEST-2026-08-26-BRIEF.md` did not exist on
`main`**, while a brief whose header read `**Executes:** …` did. That brief's PR would have gone
green citing a document nobody could open.

⚠️ **The near-miss was caught by a human-style check, not a gate** — reading the state of a PR nobody
was driving. That is not a repeatable control, which is the whole argument for this one.

## 3 · Measured, and the SCOPE is the load-bearing choice

Over `briefs/*.md` at `c0505b99`:

| filter | refs found | dangling | verdict |
|---|---|---|---|
| the `**Status:**` header LINE only | **267** | **1** | the 1 is #1840's, in flight |
| the first 8 lines of the file | 289 | 2 | ⚠️ **1 false positive** |

The wider filter flags `ESM-MIGRATION-YYYY-MM-DD-BRIEF.md`, which is **not a defect**: it is a
template name inside quoted prose (*"it becomes its own multi-phase brief (…)"*), and the real
`ESM-MIGRATION-2026-07-15-BRIEF.md` exists with the date filled in. **A 50 % false-positive rate at
n=2** — small n, but the mechanism is clear and would recur: prose *about* briefs quotes unfilled
template names, and prose lives below the header.

So the rule is: **resolve backticked `*-BRIEF.md` names on the `**Status:**` line, and nowhere else.**

## 4 · Honest statement of value

🔴 **This check finds ZERO real defects on current `main`** (the single hit resolves the moment #1840
merges). Its value is **prospective**, and this section exists so nobody reads §3's table as a bug
count. What it buys is that the failure above becomes *impossible to ship* rather than *caught by
somebody happening to look* — the same argument that justified `commit-shape` and `stale-file`.

It is also **cheap and total**: 267 references, a filesystem existence check each, no network, no
build. It runs in the Node lane beside the existing `DOCS-INDEX` link check, which already owns the
brief-set inventory this needs.

## 5 · Deliberately NOT included

- **Prose references below the header.** §3 measures why: 50 % false positives, and a brief legitimately
  discusses briefs that do not exist yet. Gating prose would re-create the noise that made
  `citation-ledger` exclude `briefs/`.
- **`docs/`, `audits/` or root docs in a header.** Not measured; do not extend the rule to populations
  whose false-positive behaviour is unknown.
- **Any check that a cited brief is *appropriate*** — only that it EXISTS. Relevance is not decidable.

## 4a · EXECUTED 2026-08-27 — built, and §3's premise corrected

**The hole is real, demonstrated before building.** Per the day's method the gate was checked first:
a dangling `**Executes:**` ref planted in a real brief header ran `docs-ledger` **38/38 GREEN**. With
check7 the same plant REDS (exit 1), naming file and ref. Before/after on one plant, not an argument.

### ⚠️ §3's scope reasoning is wrong for this repo, and §3's number does not reproduce

§3 argues the `**Status:**` line is safe *because prose lives below the header*. Measured today: **prose
lives ON it.** Long DONE headers carry multi-sentence parentheticals — `APNEA-TYPING-FUSION-2026-07-18`'s
status line alone names **four** briefs in narrative.

Re-measured with a Status-line extractor at §3's own revision `c0505b99`:

| | §3 states | re-measured at `c0505b99` | at HEAD |
|---|---|---|---|
| Status-line refs | 267 | **526** | 538 |
| dangling | 1 | **1** | **0** |

The dangling ref is exactly the one §3 predicted (#1840's, in flight; resolved by HEAD). **The semantics
match and only the count does not** — which is why the check was built and the number restated, rather
than either taken on trust.

### The scope decision, and why it is not the keyed form

Restricting to keyed refs (`**Executes:** \`X\``) yields **338** — and it **fails OPEN**. The relation
vocabulary is open-ended: **51 distinct keys** are already in use (`Follows` 128, `Relates` 22,
`Followed-by` 19, `Parent` 15 … down to one-offs like `Supersedes-section-of`), and the next brief coins
the 52nd. An allowlist that misses a verb goes blind exactly where `computeHash`'s denylist reasoning
says it must not.

**Every backticked `*-BRIEF.md` on the Status line fails CLOSED** — a new verb is covered the day it is
coined. Its cost is prose-in-header false positives, and that is **measured, not assumed**: 538 refs
across 476 briefs, **0 dangling**. §5's `ESM-MIGRATION-YYYY-MM-DD-BRIEF.md` false positive lives in body
prose and stays out; the one-line scope is pinned by a self-test so a later widening to the header BLOCK
cannot re-admit it.

### Done-when, met

- [x] check7 resolves backticked `*-BRIEF.md` on the `**Status:**` line against the brief set.
- [x] A planted dangling ref REDS the group — proven twice, and in a real brief header, not only in a
      string literal. §4's honest note stands: this finds **zero** real defects today, so without a
      plant it would be indistinguishable from a check that examines nothing.
- [x] The false-positive boundary is pinned (prose below the header ignored; unbackticked names ignored,
      those being check4b's).

## Done when

- [ ] `docs-ledger` resolves backticked `*-BRIEF.md` names on the `**Status:**` line against the brief set.
- [ ] A self-test plants a dangling header ref and asserts the group REDS (the house discipline: a check
      verified only by passing on clean input is a check that has never been shown to fail).
- [ ] The false-positive boundary is pinned by a test carrying `ESM-MIGRATION-YYYY-MM-DD-BRIEF.md` in
      PROSE and asserting the group stays GREEN — otherwise a later "improvement" widens the scope and
      re-admits it.
