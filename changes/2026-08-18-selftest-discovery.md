---
bump: patch
type: fixed
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

**Three tools' selftests were never run, and five more had never run at all — 8 of 52, invisible.**

`tools/selftest-all.mjs` and the CI step it mirrors (`tests.yml`, "Analysis-tool selftests") DISCOVER
tools by grepping for the literal `--selftest`. Eight tools spelled the flag `--self-test`; three of
those also matched it with `===` rather than `.includes()`, missing `declaresSelftest` for a second,
independent reason. Discovery found 44 tools. It should have found 52.

**Nothing could see it.** The CI step refuses a run that finds fewer than ten selftests — a floor met
comfortably by the other 44. `selftest-all` reports an assertion COUNT so a suite shrinking from 30
legs to 3 is visible — but a tool that is never invoked contributes no count to shrink. A selftest
under a name discovery does not recognise is *indistinguishable from a passing one*, which is this
repo's signature defect wearing a new hat.

Enrolled by accepting `--selftest` (the convention) as an alias in all eight:
`aperiodic-offset` · `beat-capture-recapture` · `beat-error-recovery` · `beat-injection-recovery` ·
`known-clock-recovery` · `formula-constant-audit` · `guide-anchor-audit` · `strip-markup`.
**All five pre-existing ones pass** — no latent bug, but they had been unverified for their whole
existence. 44 → 52 tools, 577+ assertions.

**The near-miss is now DETECTED, not merely fixed** (`declaresNearMissSelftest`): a file holding
selftest machinery (`function selfTest`, or the hyphenated flag) that `declaresSelftest` rejects is
reported and reds the run. Fixing the eight without this would leave the ninth author to repeat it.
The detector is gated by the mechanism it guards — `selftest-all` is excluded from its own discovery
list, so it now answers `--selftest` itself with 9 legs over both predicates, and the CI loop finds it
by that same literal.

---

**`stripScripts` regex → shared index scanner, and the same defect fixed in a second tool.**

CodeQL flagged `js/bad-tag-filter` on `tools/guide-anchor-audit.mjs` a THIRD time. `<\/script>` missed
`</script >`; `<\/script\s*>` missed `</script foo>` — HTML permits, and ignores, attributes on an END
tag. Each fix satisfied the previous alert's example and left the class open; that is the tell that the
TOOL was wrong rather than the pattern. Replaced with `tools/strip-markup.mjs`, which INDEX-SCANS
(find the open tag, find the next close, skip to its `>` however spelled) and so cannot have variant
gaps. An unclosed element truncates to end-of-input — everything after an unterminated `<script` IS
script, so returning the tail would mine executable text as prose.

`tools/doc-search.mjs:188` carried the identical regex, flagged by the same rule, and now shares the
scanner. **Reproduced before fixing, with a control that had to fire:** against `origin/main`'s
`readDoc`, `</script >` and `</script foo>` leak and the other two spellings do not — exactly the
predicted pattern. The consequence differs per tool and neither is XSS (neither renders): in
`guide-anchor-audit` a leaked body regenerates the seven phantom dead links the strip exists to remove;
in `doc-search` it becomes SEARCHABLE TEXT, inverting that tool's own stated premise that "the comments
ARE the document" by landing hits in minified `for (var i = 0; ...)`.

12 scanner legs, one per spelling that broke a regex, plus two anti-vacuity legs without which a strip
that deleted everything would pass.
