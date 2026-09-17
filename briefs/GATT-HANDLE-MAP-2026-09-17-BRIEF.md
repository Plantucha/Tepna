<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-09-17 · **Executes:** `BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md` §1.1, **ruled BUILD by the owner 2026-09-17** (that brief's §5 path (a)) · **Owner:** unassigned — needs a **box session**; deploys to vigil are owner-authorized only · **Relates:** `capture-host/devcaps.py` (the persistence precedent), #2373 (`_settle_gatt_chars`, the mitigation this replaces the need for)

> **Do not remove `_settle_gatt_chars` as part of this.** It is a settle-and-retry standing in for this
> remedy, it is measured working, and removing it in the same unit that introduces a new addressing
> path would make a regression unattributable. Retire it in a follow-up, on evidence.

---

## 1 · The defect, already measured — do not re-derive it

connect → BlueZ sets `ServicesResolved=true` → bleak snapshots the D-Bus object tree → we look up a
UUID in that snapshot. **Three surfaces stacked, and the middle one is a cache we do not own.** bleak
reads the `Connect` reply on a per-connect `MessageBus` and `InterfacesAdded` on its **global** one, so
nothing orders the two: *"ready" is not a fact about the tree.*

Measured (#2372, 2026-09-09): **seven events, six byte-identical**, holding `00001801-…[]` — the
Generic Attribute service alone, lowest handles and therefore first on the wire, no characteristics,
vendor service absent entirely; the seventh had advanced by exactly one object. **bleak was not missing
the tail of the tree — it snapshotted while nearly all of it was still in flight.**

And the root cause is a category error in BlueZ, not in us: it gates its GATT cache on
`gatt_cache_is_enabled() = device_is_paired()`, **spending a SECURITY property as a CONSISTENCY
property**. That is why the unbonded adapter raced while the bonded one never did.

---

## 2 · What to build

Discover the attribute table **once per device**; persist our own `{uuid → handle}` map keyed on the
peripheral's **Database Hash**; thereafter address characteristics **by handle**. No snapshot, no
lookup into a foreign mirror, no window. The Database Hash is exactly the staleness signal this needs,
and it is the mechanism BlueZ itself uses on the bonded path that has never failed here.

**Mirror `devcaps.py`, do not invent a second shape.** It already solves the same problem one level
over: a per-unit runtime fact, keyed by BLE address, persisted across restarts, write-through, and —
the part that matters — **an unmeasured entry reads `null`, never a default**. A handle map with a
fabricated entry is worse than no map.

---

## 3 · Verify these BEFORE designing on them

Each is cheap, and each could change the shape of the unit. `trace-to-the-consumer`, and
`presence-of-file-is-not-presence-of-data`.

1. **Can we READ the Database Hash on this stack?** It is characteristic `0x2B2A` in the Generic
   Attribute service `0x1801` — which is, pointedly, the ONE service that was present in every failed
   snapshot. Confirm it is readable on each device class we capture (H10, Verity, O2Ring, AS11) and
   what it returns when the peripheral does not implement it. **A device with no hash is not a
   failure — it is a device this optimisation cannot cover, and it must fall back, visibly.**
2. **Does bleak address by handle on the pinned version?** `>=0.22`; `c.handle` is already read in
   `capture.py:9613`, so handles are observable — that is not the same as being *addressable*. Check
   what `read_gatt_char` / `start_notify` accept, and whether the handle path still traverses the same
   object mirror internally (if it does, this buys nothing and the unit changes).
3. **What happens to a stale map?** The failure to design against is not a miss, it is a **wrong
   handle** — reading the right bytes from the wrong characteristic, which no exception surfaces.
4. **Does the mid-publish tree still reach us?** The done-when demands a refusal, so there must be a
   point where a partial tree is detectable as partial.

---

## 4 · Done when (verbatim from §1.1, plus what execution owes)

- [ ] A device's handle map **survives a disconnect**.
- [ ] A **forced Database-Hash change re-discovers** — planted, not waited for.
- [ ] A **planted mid-publish object tree cannot produce a wrong handle — it produces a refusal.**
      This is the load-bearing one: a wrong handle is silent, and silence is the failure mode.
- [ ] A device that exposes **no** Database Hash falls back to today's path **visibly** (a counter or a
      status field), never silently.
- [ ] `_settle_gatt_chars` is **still present and still firing** — or its removal is a separate,
      evidence-backed change.
- [ ] `capture-host/check.sh` green (ruff · shellcheck · `pytest --cov --cov-branch
      --cov-fail-under=100`) — the script, not a hand-built pytest line.
- [ ] The new module joins the mutation `DEFAULT_FLEET`.
- [ ] A box session validates it on the real four devices, owner-authorized.

## 5 · Sequencing and risk

**This changes how every characteristic is addressed on the capture box**, so it is the highest-blast-
radius unit currently open. Land it behind the existing path rather than in place of it: discover and
persist first, address by handle second, and keep the UUID path reachable until a night of real
captures has run both. The AS11/CPAP rail is the one with the measured failure, so it is the natural
first rail — and the one where a regression is most visible.

## Cross-references
- Parent: `BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md` §1.1 (ruled BUILD 2026-09-17) · siblings promoted: §1.2 `SAMPLE-VALIDITY-ENVELOPE-2026-09-17`, §1.4 `BLE-TIMEBASE-AT-THE-EDGE-2026-09-16`.
- Precedent to mirror: `capture-host/devcaps.py` (#2561).
- The mitigation this supersedes the NEED for, and must not remove: #2373 `_settle_gatt_chars`; residue closed `fixed #2376`.
