---
bump: patch
type: fixed
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

`tools/formula-constant-audit.mjs` decoded HTML entities in SEQUENTIAL passes, which double-unescapes.
Reproduced before fixing: a deliberately escaped literal `&amp;#x41;` came out as `&#x41;` —
indistinguishable from a live entity the document does not contain. Found by CodeQL on the PR that
introduced the tool (`js/double-escaping`, plus `js/incomplete-multi-character-sanitization` on the
single-pass tag strip), and worth having on the record that the tool built to catch decoder leniency
shipped with a decoder defect.

FIXED by decoding in ONE pass over a single alternation — hex, decimal and the named references together
— so each source construct is consumed exactly once and an escaped literal stays literal. Tag-stripping
now runs to a FIXPOINT rather than once: a lone `<[^>]+>` pass can leave `<script` behind on nested or
malformed markup, which is not an injection risk here (the tool reads repo-owned guides and renders
nothing) but IS text the sweep would then mine for constants. "Not exploitable" is not "correct".

The out-of-range branch is the one that matters for this audit: `&#x110000;` is refused and returned
VERBATIM rather than thrown or guessed, and an unterminated `&#x201CFair` is left INTACT. That is
deliberate — those are exactly the malformed references the sweep exists to surface, and a decoder that
repaired them would be the leniency this tool was written to replace.

Five decoder properties are now self-test legs (14 total, counted not hardcoded): nested escape survives
exactly one decode; unterminated reference stays reportable; out-of-range refused; well-formed reference
decodes; tags stripped to fixpoint.

Behaviour-preserving on the corpus — the fleet sweep still reports the same 6 flags of 67
constant-bearing formulas across 381, so the correctness fix moved no findings.

Also recorded: CodeQL is NOT a required check on this repo, so #1482 auto-merged with this alert open.
That is the ruleset's intent (alerts advisory, not gating) rather than a defect, but it means a CodeQL
finding needs someone to look — it will not stop a merge.
