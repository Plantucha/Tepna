---
bump: patch
type: changed
nodes: []
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

Verifies every citation in the seven reference guides against the DOI registry, the audit's first
dimension. All 55 distinct DOIs resolve at doi.org, extracted from the href form so the match cannot be a
prose artifact. Three initially read as failures -- 405 on a Thieme DOI and 202 on two IEEE ones -- and
all three are publisher-side HTTP behaviour rather than unregistered DOIs, since doi.org returns 302 with
a correct Location for each.

Resolution alone only proves a DOI exists, so each one's registry metadata (journal, year, volume, issue,
pages) was compared against the citation text beside it. All 55 match. Two flagged on year and both were
disproved: their registry `issued` dates are online-first, while their `published-print` fields agree
with the guides' print citations exactly.

Nine DOIs are cited in more than one guide and six differed only in page-range style, expanded in
ECGDex/OxyDex and Vancouver-abbreviated in HRVDex/PpgDex/PulseDex. Both are valid styles, but the audit
asks for shared sources to be identical, so fifteen ranges across three guides were expanded to the
registry's own page value -- an authoritative normalisation rather than a house preference. Rechecked
afterwards, no shared DOI differs. Two further candidates the sweep produced were regex artifacts from
letter-prefixed pagination and were excluded by hand; only exact-string replacements with a per-edit
assertion were applied. No citation needed replacing or removing.
