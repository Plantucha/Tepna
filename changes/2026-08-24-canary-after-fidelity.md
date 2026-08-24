---
bump: patch
type: fixed
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---

`tools/mutation-crawl.mjs` — a `KILLABLE` record carried the original text and the operator NAME but
**not the replacement**, so `mutation-ai-probe`'s canary replayed the wrong mutation.

`canaryFor` calls `mutateAtLine(src, line, before, after)`, which does
`line.replace(before, String(after).trim())`. With `after` absent that is `String(undefined)` — the
**literal identifier**. Measured: `if (a > 0)` was replayed as `if (undefined)`, an expression-nulling
mutation nobody recorded, standing in for the `cmp > → >=` that was.

**Fleet-wide: 165 `KILLABLE` records, 0 carrying `after`.** So the canary has been proving the harness
can detect *a* difference, never that it can detect **the recorded one**. It passed as a liveness check
by accident — nulling an expression usually also kills. The line that builds the mutant already used
`m.after`; it was simply never persisted.

⚠️ **This also explains the crashes behind the other defect fixed today.** Nulling a *declaration* line
means the variable is never declared, so later use throws `t0 is not defined` — which is exactly the
`THREW` that `verdictFor`'s size guard was swallowing (#1720). Two defects, one chain.

**Deliberately NOT changed: the canary's runtime behaviour.** Making `mutateAtLine` refuse an absent
`after` is the right end state, but every existing crawl record lacks it, so refusing today would take
the whole nightly pipeline down and re-impose the re-crawls that were just shown unnecessary. The root
fix lands first; new crawls carry `after`; the refusal becomes reachable and correct after that, and is
recorded as the follow-up.

Four controls: a recorded op round-trips exactly and the original text is gone; and the
identifier-substitution signature is pinned by name, so the defect is recognisable rather than
invisible. 74 selftests.
