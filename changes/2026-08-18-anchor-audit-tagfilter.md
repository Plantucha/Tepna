---
bump: patch
type: fixed
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

`tools/guide-anchor-audit.mjs`'s script-strip missed `</script >` — a valid HTML closing tag with
whitespace — so the ENTIRE script body leaked through as "markup". Found by CodeQL
(`js/bad-tag-filter` + `js/incomplete-multi-character-sanitization`) on the PR that introduced the tool,
and REPRODUCED before fixing.

NOT COSMETIC, AND NOT A SECURITY ITEM HERE. The tool reads repo-owned guides and renders nothing, so
injection is not the risk. The risk is that leaking a script body regenerates EXACTLY the defect the
strip was written to prevent: a runtime-built `href="#'+target+'"` is then read as a real anchor, and the
sweep reports the seven phantom dead links that its own header documents as the reason it strips scripts
at all. The instrument would have re-acquired the blindness it was built to remove, in the one construct
it was built to remove it from.

Latent today only because no guide currently spaces that tag — one `</script>` per guide, all unspaced.
That is luck, not design, and it is exactly the kind of luck that expires when someone reformats a file.

FIXED three ways, each from a distinct failure mode rather than from tidiness:
  · `<\/script\s*>` — whitespace in the closing tag;
  · loop to a FIXPOINT — one pass can leave a `<script` behind on nested or malformed markup;
  · an UNCLOSED `<script` truncates to end-of-input. That is the worst case: the lazy quantifier finds no
    partner, so the whole tail would be mined as content. Everything after an unterminated script tag IS
    script, and truncating is the honest read.

Three self-test legs added (10 total, counted): spaced closing tag stripped; unclosed script truncates
rather than leaking its tail; real markup BEFORE a script survives — the anti-vacuity leg, without which
a strip that deleted everything would pass the other two.

Behaviour-preserving: the fleet sweep still reports 0 defects across 768 links, 269 ids and 246
abbreviations in 7 guides.

SECOND TIME CODEQL HAS FOUND A REAL DEFECT IN A TOOL I SHIPPED THE SAME DAY (after
`formula-constant-audit`'s double-unescaping decoder), both in regex-based HTML handling, both in the
instrument rather than the corpus. Worth stating plainly: hand-rolled HTML regexes are where my audit
tooling breaks, and CodeQL is currently the only gate catching it — it is advisory here, so it does not
block a merge and needs a human to look.
