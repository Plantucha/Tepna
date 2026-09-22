---
bump: minor
type: added
brief: none
---

`tools/pat-window-oracle.mjs` emits its run as one `tepna.verdict/1` object beside the prose table, mapped onto the bands it already pre-states (`BAND_RECOVERED` 20 ms, `BAND_PARTIAL` 60, null must be beaten) so no threshold is invented: PASS every scored unit inside the band · SHORTFALL some · FAIL none · UNDERPOWERED units offered and none scorable · NOT_RUN no units · UNKNOWN an UNDEFINED band, with named refusals excluded from the population rather than averaged into it. Its `verdict-adoption.json` row moves from a copy-pasted `word-only` exemption to `decides`/`adopted`, shrinking `WO_CLAIM_RATCHET` from nine to eight.
