<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [PpgDex]
brief: none
---
**`PpgRegistry.idForSite` had no caller.** `PPGDEX-O2RING-FINGER-SITE §5` built seven `*Finger` metric entries so an O2Ring finger pleth could not inherit wrist-validated grades, and the suite gated the mapping — but every rendered badge went `evBadge → badgeForLabel → idForLabel → the base id`, which never consults a site. So the downgrade reached **zero pixels**: a finger recording drew the wrist grade, and `notchTime`/`pulseWidth` rendered `measured` where the finger entries say `experimental`.

`badgeForLabel` now resolves through an ambient active site that `renderSession` sets before any render. Threading a site argument through each `evBadge(label)` call site would have missed the ones nobody enumerated — which is how the hole opened.

**A wrist is now declared, not assumed.** `site` comes from the file layout, which names the *device*, not the limb: 3 optical columns = a Verity Sense, and a Verity is a strap. On this deployment it is worn on the **left ankle** while every export said `wrist`. So `wrist` is the one site inferred that the hardware does not guarantee — an undeclared one resolves to a `*Assumed` entry at `experimental`, and PpgDex offers a site control (wrist / ankle / upper arm) that stamps `siteSource: 'declared'` onto the record for both render and export. The **finger** site keeps re-scoping without a declaration, because a 1-column pleth genuinely *is* a ring.

Adds seven `*Ankle` and seven `*Assumed` entries. Rate and timing metrics — HR, PPI, rate-domain HRV, quality statistics — are deliberately untouched: they come off the same audited pipeline and do not care where on the body the beat was seen.
