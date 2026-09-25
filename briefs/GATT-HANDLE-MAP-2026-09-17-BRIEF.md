<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED (core BUILT, remainder box-gated — verified 2026-09-25, Kestrel triage, docs only: the recorder is `capture-host/gattmap.py` — #2603 records the expected table per unit keyed on the Database Hash, #2604 makes `_settle_gatt_chars` wait for the WHOLE recorded table instead of two named UUIDs (the settle is still present, 6 sites in `capture.py`), #2611 writes on CHANGE not on every connect, #2662 keeps `recorded_at` across a deploy; `missing()` distinguishes `None` = no oracle for this device (fall back) from `[]` = complete, and `snapshot()` exposes the per-unit hash/count, which is the visible no-hash fallback. Of the §4 done-whens, "survives a disconnect" is proven (§3b) and the settle/`check.sh` items are met by the merged PRs; the two PLANTED items — a forced hash change re-discovers, a mid-publish tree REFUSES — have no test whose name says so in `tests/test_gattmap.py` (`record()` returns `"changed"` on a moved hash, which is the mechanism, not the plant), and the four-device box validation is still owner-gated with H10/Verity/O2Ring unobserved since 09-18. Owner still unassigned) · **Created:** 2026-09-17 · **Executes:** `BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md` §1.1, **ruled BUILD by the owner 2026-09-17** (that brief's §5 path (a)) · **Residue:** 2026-09-18-as11-implements-robust-caching · **Owner:** unassigned — needs a **box session**; deploys to vigil are owner-authorized only · **Relates:** `capture-host/devcaps.py` (the persistence precedent), #2373 (`_settle_gatt_chars`, the mitigation this replaces the need for)

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
peripheral's **Database Hash**; ~~thereafter address characteristics **by handle**. No snapshot, no
lookup into a foreign mirror, no window.~~ ⚠️ **STRUCK — see §2b②: bleak resolves a handle through the
same snapshot, and the parent's §3 refuses the raw-ATT alternative.** Use the map as the COMPLETENESS
ORACLE instead (§2b③): the snapshot is usable when it matches the map for that Database Hash, and
anything else refuses. The Database Hash is exactly the staleness signal this needs,
and it is the mechanism BlueZ itself uses on the bonded path that has never failed here.

⚠️ **THIS ORACLE IS NOT A POOR MAN'S PUSH — do not let a reader size it as one** (residue
`2026-09-18-robust-caching-is-not-a-reachable-ceiling`, #2649). The AS11 does expose `0x2B29` CLIENT
SUPPORTED FEATURES beside `0x2B2A`, so it is tempting to read a hash comparison as settling for the
weaker half of Robust Caching while push was available. It is not, and the reason generalises past this
device: **Service Changed and Database Out Of Sync fire when the server's DATABASE CHANGES.** §1's
measured defect is not a change — nothing changed. bleak snapshotted the D-Bus tree **while it was
still being populated**, so our *view* was incomplete on that connect. A change-notification, even
settable and delivered perfectly, says nothing about that and leaves the race exactly where it was.

So the oracle **is not a weaker substitute for push; it is an independent completeness check on a
mirror we do not own** — a different job, and the only one available at this layer. Two supporting
facts, both measured: no application-layer client here can set the bit at all (pinned bleak carries
`0x2B29` only as a label in `uuids.py`, and its BlueZ backend never writes it), and with BlueZ's cache
disabled by the `device_is_paired()` gate there is no cached table to invalidate, so the push half has
nothing to act on. The remedy for the unbonded path was already found and is bonding
(`2026-09-10-cpap-unbonded-reason-was-wrong`), not a client feature bit.

**Mirror `devcaps.py`, do not invent a second shape.** It already solves the same problem one level
over: a per-unit runtime fact, keyed by BLE address, persisted across restarts, write-through, and —
the part that matters — **an unmeasured entry reads `null`, never a default**. A handle map with a
fabricated entry is worse than no map.

---

## 2b · 🔴 RECONNAISSANCE RESULTS — 2026-09-17, and one of them REFUTES §2 as written

§3's checks were run before designing. Read this before §2; §2's mechanism does not survive check 2.

**① THE RACE IS LIVE — it never stopped, it stopped FAILING.** Measured on vigil's journal, 14 days:

| signal | count | when |
|---|---|---|
| `no service snapshot (BleakError)` — the hard failure | **109** | **all on Sep 09**, none since |
| `BlueZ had not published …` — the settle FIRING and absorbing it | **466** | Sep 10→17, **every single day**: 10 · 138 · 102 · 39 · 41 · 40 · 79 · 17 |

So `_settle_gatt_chars` is doing real work **40–140 times a day, continuously**. The mitigation did not
make the race go away; it made it survivable. That is the measured case for this unit, and it is a
stronger one than the brief was written with.

**② 🔴 BLEAK CANNOT ADDRESS BY HANDLE INDEPENDENTLY OF THE SNAPSHOT — §2's mechanism is refuted as
stated.** `read_gatt_char(char_specifier: Union[BleakGATTCharacteristic, int, str, UUID])` accepts an
`int`, so a handle is *accepted* — but its first line is
`characteristic = _resolve_characteristic(char_specifier, self.services)`, and `_resolve_characteristic`
does `services.get_characteristic(char_specifier)`. `self.services` is the backend's collection, which
**is the D-Bus snapshot**, and it raises `BleakError("Service Discovery has not been performed yet")`
when it is empty — which is exactly the `no service snapshot (BleakError)` line counted above.
So *"thereafter address characteristics by handle"* routes through the same mirror the whole unit
exists to stop trusting. `start_notify` resolves identically.
⚠️ **And the escape hatch is closed by the parent:** §3 of `BLE-TRANSPORT-REDESIGN` REFUSES a raw ATT
path — *"`HCI_CHANNEL_USER` stays disqualified, no rewrite"*. So bypassing bleak is not available
either. `c.handle` being readable at `capture.py` `_gatt_snapshot` proved handles are EXPOSED; it never proved they
were ADDRESSABLE, and that distinction is the whole of this finding.

**③ THE GOAL SURVIVES — as an ORACLE, not an addressing path.** §1.1's done-when never asked for
handle addressing; it asked that *"a planted mid-publish object tree cannot produce a wrong handle — it
produces a refusal"*. That is a **completeness** property, and the persisted map delivers it directly:
today `_settle_gatt_chars` waits for **two hardcoded UUIDs** (`GATT_RX`, `GATT_TX`) and calls the tree
settled when they appear — a heuristic that cannot see a tree missing anything else. A map keyed on the
Database Hash states the FULL expected attribute table for that peripheral, turning that heuristic into
a deterministic check: *the snapshot is complete when it matches the map, and anything else is a
refusal.* Same done-when, a mechanism that exists.

**④ CHECK 1 IS UNANSWERED, and my instrument cannot answer it.** Is `0x2B2A` readable per device class?
The only characteristic handle in 14 days of journal is `00002a05@0x0002` (Service Changed) — because
this logging fires **only on failure snapshots**, which are near-empty by construction. An instrument
that observes only broken trees cannot report what a healthy one contains, so the absence of `0x2B2A`
here is **not** evidence the devices lack it. Answer it from a successful-tree dump or from the two
external references already indexed (`ext:SomnoTrace/main/as11_ble.c` captures AS11 handles;
`ext:polar-ble-sdk` enumerates the Polar tables) — **not** by connecting to a device mid-capture.

**Consequence for this brief:** §2's *"address by handle"* is struck; the unit becomes *discover once,
persist keyed on the Database Hash, and use the map as the completeness oracle that `_settle_gatt_chars`
currently approximates*. The blast radius drops sharply — nothing changes about how characteristics are
addressed, so the §5 warning about the highest-blast-radius unit no longer applies in that form.

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
   `capture.py` `_gatt_snapshot`, so handles are observable — that is not the same as being *addressable*. Check
   what `read_gatt_char` / `start_notify` accept, and whether the handle path still traverses the same
   object mirror internally (if it does, this buys nothing and the unit changes).
3. **What happens to a stale map?** The failure to design against is not a miss, it is a **wrong
   handle** — reading the right bytes from the wrong characteristic, which no exception surfaces.
4. **Does the mid-publish tree still reach us?** The done-when demands a refusal, so there must be a
   point where a partial tree is detectable as partial.

---

## 3b · 🟢 BOX SESSION RESULT — 2026-09-18 (Wren, read-only on vigil)

**§3's check 1 is ANSWERED for the rail that had the measured failure.** No deploy was needed: the
owner-sanctioned `tepna-update.timer` had already pulled and restarted at 04:21:02, and three shas
agree — `/api/version` = `HEAD` = `origin/main` = `d5a9adaf`, with a fresh unit `ActiveEnterTimestamp`.

**AS11 `04:CD:15:3A:0B:BD` — 14 characteristics, db_hash `4bcd397d247ef57c824749823578b2b7`**, 9 SIG +
5 vendor, `0x0005` = `2B2A` DATABASE HASH. So the oracle's staleness signal **can** cover this rail.
Cross-checked twice: the 2026-09-08 btmon put the notify CCCD at `0x0023` (consistent with the value at
`0x0021`), and `ZEPHYR-INSTRUMENT`'s *"5 services / 14 characteristics"* from the unbonded open matches
n=14 exactly. Three vendor UUIDs (`3d5085ac`, `1681c44f`, `e5e33ba4`) appear nowhere else in the repo.

**Map survival is PROVEN rather than argued.** First record 21:06:10; two daemon restarts followed
(21:50:53, 04:21:01); after each the daemon re-recorded the identical table. That closes *"a device's
handle map survives a disconnect"* with evidence.

⚠️ **H10 · Verity · O2Ring are NOT OBSERVED, which is a different word from absent** — nothing has been
worn since the restart, so the map has no entry. That is silence from the instrument, not a fact about
the devices, and the reporter declined to manufacture a session to fill it.

🔴 **And a ceiling finding the narrow question would have missed** — `0x2B29` CLIENT SUPPORTED FEATURES
sits beside `0x2B2A`: the Bluetooth 5.1 **Robust Caching** pair. The AS11 implements the whole
change-aware protocol, in which a client that sets the bit is TOLD when the table moves rather than
discovering it by mismatch. This unit polls; the device offers push. Residue
`2026-09-18-as11-implements-robust-caching`. It surfaced only because the run sheet was widened to
report the WHOLE table rather than a verdict about one characteristic.

## 4 · Done when (verbatim from §1.1, plus what execution owes)

- [x] A device's handle map **survives a disconnect** — proven 2026-09-18 across TWO daemon restarts, identical table re-recorded after each (§3b).
- [ ] A **forced Database-Hash change re-discovers** — planted, not waited for.
- [ ] A **planted mid-publish object tree cannot produce a wrong handle — it produces a refusal.**
      This is the load-bearing one: a wrong handle is silent, and silence is the failure mode.
- [ ] A device that exposes **no** Database Hash falls back to today's path **visibly** (a counter or a
      status field), never silently.
- [ ] `_settle_gatt_chars` is **still present and still firing** — or its removal is a separate,
      evidence-backed change.
- [ ] `capture-host/check.sh` green (ruff · shellcheck · `pytest --cov --cov-branch
      --cov-fail-under=100`) — the script, not a hand-built pytest line.
- [x] ~~The new module joins the mutation `DEFAULT_FLEET`.~~ **CORRECTED 2026-09-17 — that was the wrong fleet.** `DEFAULT_FLEET` lives in `tools/mutation-crawl.mjs` and is the **JS** fleet; it takes `.js` files only. The Python gate is `capture-host/tools/mutate_diff.py`, which is **DIFF-SCOPED with no list at all**, so a new `capture-host/*.py` module is in scope automatically and there is nothing to join. Written from the JS habit without checking which gate applies — the same enumeration reflex this brief warns about two sections up.
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
