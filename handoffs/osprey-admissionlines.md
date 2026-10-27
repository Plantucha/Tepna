# Osprey — what the remaining 51 census keys admit (2026-10-25, measurement only)

**Unit.** Size the rest of the census backlog under the held row
`2026-10-21-forty-one-corpus-enumerators-report-no-population`, after #3926 wired the five
night-shaped keys. No PR: the one-PR cap holds #3926, so this unit is measurement and a report.

**Branch + worktree.** Read-only in `wt-nightkeys-osp` at `b3751bbf3`. Nothing staged, nothing edited.

**The artifact.** One row per remaining key — tool, weight, class, and the admission predicate read
verbatim from beside its `readdirSync`. It lives in this session's scratchpad as
`admission-lines.tsv`, and the generator is nine lines of `node --input-type=module` recorded in the
board report; a resumer regenerates it rather than trusting a copy.

**Measured, 51 keys and weight 73 at this head.** Binned on the predicate alone:
`night-ruled` 19 keys / weight 37 · `unruled` 24 / 26 · `file-ruled` 8 / 10. One of the 19 is a
mis-bin and the correction is below, so the night-shaped set to wire next is **18 keys, weight 25**.

🔴 **A HARD-CODED YEAR IS A NIGHT RULE THAT EXPIRES, AND SIX KEYS CARRY IT UNACCOUNTED.**
`pat-literature-spec` · `pat-mode-posture` · `pat-per-led` · `pat-three-corner` · `pat-window-oracle` ·
`ppg-foot-residual-sweep` admit nights with a bare `/^2026-/.test(d)` in a `.filter()`. Over a control
root holding `2026-06-11` and `2027-01-02`, each scored exactly one night and never mentioned the
other; `pat-mode-posture` published `"population":{"checked":0,"eligible":1,"excluded":1}` while the
root offered two night-shaped names. Five further tools pass the same `^2026-` rule through
`snapshotNights`, where `ruleRejectedNightShaped` names the refusal — and `corpus-scope.mjs:625`
already holds a selftest for a 2027 night under that rule. **The rule is not the defect; an
unaccounted rule is.** That is a row I owe and cannot log under the one-PR cap.

⚠️ **A TEXT-KEYED CLASSIFIER MIS-BINS, AND EACH REFINEMENT MOVED MEMBERS.** Three passes over the same
51 keys gave three memberships. `closure-tol-hac`, `rho-overlap-power` and `cpap-corpus` crossed bins
between passes, and the final predicate-keyed pass still calls `stage-lab` night-ruled, because the
`\d{4}` inside its dataset record id `^tr\d\d-\d{4}$` trips any date test. **Only the admission
predicate read verbatim decides a key's class.**

⚠️ **CPAP SPELLS A NIGHT `YYYYMMDD`.** `cpap-corpus` admits on `/^\d{8}$/`, so the primitive's default
rule would refuse every real night there. Pass the tool's own `re`, which the wiring contract already
requires, and the refusal accounting then names whatever it drops.

**Next step.** Wire the 18 night-ruled keys in weight order, in batches small enough that one
`npm run check` covers each PR, and log the year-rule row with the first of them. The six year-filtered
keys want the rule passed as `re`, never widened in passing: widening it is a separate decision.

**Open questions.** `stage-lab.mjs` (weight 12) and the three `nsrr-*` keys enumerate external PSG
records, not nights. They owe a record-population primitive or a declared exclusion, which is a
decision, not a wiring (#1254).

**Blockers.** The one-PR cap. #3926 waits on Kestrel's undraft before any of this can land.

**Doc-search query.** `node tools/doc-search.mjs --read "corpus enumerator reports no night population"`.
