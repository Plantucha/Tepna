---
bump: minor
type: added
brief: CPAP-SPOOL-ACQUISITION-2026-08-25-BRIEF.md
---

`capture-host/cpap_inventory.py` — **the spool as an inventory oracle**: what did we *miss*?

Every other CPAP surface answers *"what did we get"*. None can answer *"what was there"*, because a
night we never captured leaves nothing behind to count. **The Summary spool can** — the device keeps
its own session list, so it knows a session existed even when we captured nothing.

Three inventories in (spool · live envelopes · card DATALOG nights), one record per discrepancy out.
Pure: no transport, no async, no BLE, no polling.

## 🔴 Presence is evidence; absence is evidence only from a source that was actually consulted

The module's spine, and it was nearly missed. **Measured by Vigil box, 2026-08-28: the spool is a
once-daily Summary-only transaction**, so on a therapy-end trigger an empty spool result is the
*expected* case for the second and later sessions of a day. Reading that emptiness as *"the device
lists no sessions"* would have marked every such night `SPOOL-SILENT` — **a manufactured discrepancy
per night, forever, from a source nobody read.**

Each inventory now carries a `consulted` flag. An unconsulted source contributes its **presences** and
none of its **absences**; a night whose classification would rest on an unconsulted absence returns
`NOT-DIAGNOSABLE` naming the unread source.

⚠️ **I had the card side backwards at first.** `barren` is `consulted=True` — the walk ran and the card
**answered** holding nothing, which is evidence. The unread case is the harvest's **early exits** (Wi-Fi
down, or the listing threw — the exit an **absent** card takes). I was deriving *"was the instrument
pointed at the subject"* from what the instrument returned, which is the inference this flag exists to
forbid, made while building the flag. The transport reports `consulted` explicitly now and this module
reads it.

## Seven states, enumerated because they have opposite remedies

`MISSED-BOTH` · `MISSED-LIVE` · `NOT-ON-CARD` · `SPOOL-SILENT` · `UNSPOOLED-CARD-NIGHT` ·
`ENVELOPE-ONLY` · `COMPLETE`. *"Missing from somewhere"* is not an actionable sentence — missing from
the envelopes means the live capture did not run; missing from the spool impugns **our** record rather
than the acquisition.

## Refusals

**All three empty is `ok: false`, never "no discrepancies"** — the two produce the same empty list and
mean opposite things. Carried through to the QC field (`discrepancies: null`, not `0`) and to **one**
journal line, since zero lines is what a healthy night produces. Unparseable entries are returned, not
dropped.

⚠️ **The join key is the night**, so a night with two sessions reconciles as one unit and a session
crossing midnight is attributed to its start night — stated rather than discovered later.

## Not wired yet, deliberately

The call site is Vigil box's no-op-by-default `on_harvest_complete(result)` hook, so either half can
land first. Mutator's original framing — that the therapy-end trigger fires harvest **and** spool — is
wrong; it fires harvest only, and the spool has its own site with a config-time refusal when its window
overlaps harvest's, because both are 2.4 GHz on one box. That coupling question is deferred into the
§2 BLE coexistence matrix; the consulted-flag design makes this oracle timing-agnostic, so nothing
blocks on it.

**23 tests, 100 % statement + branch on the module.** Both directions of the consulted asymmetry are
planted on *identical* inputs — a test that planted only one would pass under a module that ignored
the flag entirely.
