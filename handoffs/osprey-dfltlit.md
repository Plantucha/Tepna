# osprey · dfltlit — a hand-written default answer, measured at every site

**1 · Unit.** Measure every site outside the primitive that writes a `ruleIsDefault` literal. Each one
owes agreement with the rule in the same literal.

**2 · Branch + worktree.** `claude/dfltlit-osp` in `wt-dfltlit-osp`, cut from `origin/main` at
`b73e9f199`.

**3 · The census, at `b73e9f199`.** Fifty-one sites write the key. Twenty-five sit inside the two files
PR #3973 already fixed. Of the twenty-six outside, thirteen write `true`, twelve write `false`, and
`tch-reference-validation.mjs:359` derives it. **None of the twenty-six gets the comparison wrong.**

Two of them carry a non-null default answer beside a null `rejectedNightShaped`, which is the shape
worth reading twice:

- `pat-three-corner.mjs:281` mirrors its own live arm, `snapshotNights(DIR, { re: /^2026-/ })`, and
  publishes `ruleIsDefault: false` for it. **Correct, and it stays.** The primitive does the same on its
  night-refusal arm: a rule the caller configured is a fact even when the walk fails, so it nulls the
  rule's EFFECT alone.
- `cvhr-edge-widen.mjs:375` published `rule: String(/^\d{4}-\d{2}-\d{2}$/)` and `ruleIsDefault: true`
  for a `--from` re-aggregation that opens no night tree and takes no rule argument. **Fixed here**, to
  `rule: null, ruleIsDefault: null`.

**4 · The fix is latent, and the PR says so.** `populationVerdict` returns `result: null` on `NOT_RUN`,
so `ruleLine` reads `population.result`, finds null, and returns the empty string. The whole rule block
dies before the fabricated fields reach a reader. Executed before and after: the `--from` run prints the
same bytes, `status: NOT_RUN`, `result: null`. So this repairs a source claim, not an output.

**5 · The gate reds the class from now on.** New legs in the night-rule group of `tests/dex-tests.js`
bin every site as computed, nulled, or a literal checked against its resolved sibling.

🔴 **The design point. My first reader of this population named five defects and all five were its
own blind forms.** It compared the `rule` text against the default's text without resolving anything, so
a quoted `'/^\d{4}-\d{2}-\d{2}$/'` at `deep-vlf-probe:172` and `ecg-apnea-correlate:220`, plus three
`String(NIGHT_RE)` imports at `tch-bootstrap-ci:332`, `tch-fused-corpus:356` and
`tch-window-sensitivity:357`, each read as a disagreement. Every one resolves to the default. So the
shipped leg puts an unreadable form in its own `UNRESOLVED` column and reds there, rather than folding
it into the defect count. Five controls over planted text run first, one per form the first reader
misread, because a scan is a tripwire and executing it is the contract.

**6 · The suite's own rule detector has a blind spot with no live carrier.** The `ruled` population is
keyed on `/snapshotNights\([^)]*\{[^}]*\bre:/`, which reads an inline rule object only. A rule declared
above the call and passed by name is invisible to it, and `corpus-scope.mjs:1050` proves the shape
exists. Measured over every caller: eighteen pass an inline rule object, twenty-four pass no second
argument at all, and the two that pass something else are `snapshotEntries` listers carrying `list:` and
`unit:`, which hold no night rule and belong outside the population. **So no live night rule escapes the
detector today.** Logged as a row, not widened here: a widening narrows elsewhere, and this one would
buy nothing measurable.

**7 · Open questions.**

- `ruleLine` prints `rule null` for a night population whose rule is null, where the entries form gets
  its own `ANONYMOUS LISTER` wording. Unreachable today, since the only such literal sits behind a
  `NOT_RUN`. A branch for an unreachable state is dead code, so it stays unwritten and named here.
- The thirteen `true` sites are each correct against their own sibling, and every one of them still
  asserts rather than computes. The gate makes that safe; it does not make it honest.

**8 · Doc-search query.** `node tools/doc-search.mjs --read "a hand-built snapshot asserts a rule
default it never compared"` → board #1347, #1295, #1346, handoff `handoffs/osprey-ruledflt.md`.
