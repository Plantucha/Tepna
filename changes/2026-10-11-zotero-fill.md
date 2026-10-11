---
bump: minor
type: added
brief: LITERATURE-USE-POLICY-2026-07-11-BRIEF.md
---

**`tools/zotero-fill.mjs` — the citation ledger mirrored into the owner's reference library, one record per DOI, idempotent.**

Owner, 2026-10-11 ("it was never connected to anything, fill it up"). Every DOI in the citation ledger is
resolved at Crossref (polite, cached as `crossref.json` beside the local literature store), mapped to a
Zotero item with every field Crossref carries and none it does not, tagged `tepna-ledger`, filed in the
collection "Tepna citation ledger", and created only if no item with that DOI exists. Key read by name
from the config directory, never printed; no updates, no deletes, no attachments. One `tepna.verdict/1`
(gate `zotero-fill`): first run created 115 of 115; the second run created 0, 115 present.
