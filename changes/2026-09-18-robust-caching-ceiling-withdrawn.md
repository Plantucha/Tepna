---
bump: patch
type: changed
brief: GATT-HANDLE-MAP-2026-09-17-BRIEF.md
---

The residue row claiming the GATT oracle settled for the weaker half of Robust Caching is withdrawn:
the observation is right, the ceiling it inferred does not exist.

Docs-only — no code changed, and that is the result rather than a shortfall.

`2026-09-18-as11-implements-robust-caching` reported the AS11 exposing `0x2B29` CLIENT SUPPORTED
FEATURES beside `0x2B2A` DATABASE HASH, and concluded the merged oracle "only POLLS the weaker half" of
a protocol whose push half was there for the taking — "a ceiling difference, not a bug". The
observation is correct and is kept. The inference fails three ways, each measured:

1. **Not reachable from this stack** — the bound the row itself flagged UNKNOWN. In pinned bleak,
   `0x2B29` appears *only* as a label in `uuids.py`'s name table; the BlueZ backend never writes it,
   and bleak's one cache concept is `dangerous_use_bleak_cache` — its own service cache, nothing to do
   with GATT caching. No application-layer client here can set the Robust Caching bit, so "the unit was
   scoped believing polling was the best available" charges a design choice for a stack constraint.

2. **Robust caching answers a different question than the oracle asks.** The measured defect (#2372,
   parent §1) is that bleak snapshots the D-Bus object tree *while it is still being populated* — seven
   events, six byte-identical, holding the Generic Attribute service alone with zero characteristics.
   Service Changed and Database Out Of Sync fire when the server's database **changes**. Nothing
   changed; our **view** was incomplete on that connect. The bit, even settable and pushed perfectly,
   leaves the race exactly where it was. The oracle is not a weaker substitute for push — it is an
   independent completeness check on a mirror we do not own.

3. **The cause of the unbonded failure makes the push half moot by construction.** §1 measures BlueZ
   gating its GATT cache on `gatt_cache_is_enabled() = device_is_paired()`, and §2 records Database
   Hash as "the mechanism BlueZ itself uses on the bonded path that has never failed here". With the
   cache disabled there is no cached table to invalidate, so a change-notification protocol has nothing
   to act on. The remedy direction was already established — bonding, per
   `2026-09-10-cpap-unbonded-reason-was-wrong` — and it is not a client feature bit.

## What the triage added that the row could not

Reading `/srv/tepna/captures/gattmap.json` partially closes the row's own NOT-OBSERVED bound: it holds
**two** units, not one. The AS11 carries both characteristics under db_hash `4bcd397d247e`; a
Polar-OUI unit carries **neither, with `db_hash: None`** across 21 characteristics — exactly the
heterogeneity `gattmap.py`'s module note already handles, answering only for `None` on such a device.

Bounds kept rather than rounded off: the Polar **model** is not established (identity is address-only,
and `devcaps.json` holds a different Polar address), so H10-vs-Verity is unresolved and the remaining
units stay NOT OBSERVED. And claim 3 follows from the parent brief's own measurement — I did not open
BlueZ's source and do not claim to have.

**ATT `0x12` stays handled nowhere, deliberately.** It is absent from `capture.py`, `gattmap.py`,
`as11_link.py` and `as11_pull.py`, and a handler for a path no layer here can reach would be
speculation dressed as coverage.

The fact itself is preserved where it is useful: `gattmap.json` records both UUIDs machine-readably
rather than in prose, and it would matter again only to a raw-ATT client — which the parent's §3
refuses.
