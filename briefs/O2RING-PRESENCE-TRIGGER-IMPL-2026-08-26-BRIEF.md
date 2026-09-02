<!--
  O2RING-PRESENCE-TRIGGER-IMPL-2026-08-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — the module is built, armed and gate-backed (41 assertions, six planted controls). Two items remain and both need the box on the owner's bench: §2's BLE coexistence matrix, which is what earns `scan_coexistence_verified` (the gate exists — `oxy_presence.py:256`, refusal at `capture.py:7355` — only the measurement is missing), and §25's A–O acceptance run with observed timestamps. Confirmed on the box today: no `presence_harvest` or `scan_coexistence` key exists in its config, so presence is default-OFF and the matrix has not been run. **Owner:** owner (box session) · **Next step:** the coexistence matrix, which also unblocks the parent charter's identical item) · **Created:** 2026-08-26

# The O2Ring presence trigger — §36's map, built as a DELTA

## 1 · Why this is a delta and not an inventory

The charter's §1 says *"First identify what already exists and what is actually missing"*, and §36
asks for a five-column implementation map before any code. Building that map from scratch would have
re-derived a **1437-line, IN-PROGRESS, owner-issued** document — `OXYII-DAT-AUTO-HARVEST-REFINEMENT`
— which already carries its own §1 architecture map and, more dangerously, **rulings**. Its own
opening warning names the risk exactly:

> *"'demote the poller' is not a proposal. It is a shipped decision. Writing this brief as though the
> trigger were missing would be the stale-capability error the house keeps re-finding."*

The relationship was ruled **EXTENDS** (2026-08-26). So the two rulings below **stand unchanged** and
nothing here amends them: the end-of-recording wait is `run_status` **3 → 1**, and the close-triggered
pull scope is **`which=latest`**.

## 2 · §36 THE MAP

### 2a · EXISTING → REUSED UNCHANGED

| component | what it already does | charter § |
|---|---|---|
| `oxy_lifecycle.OxyState` + `LEGAL_TRANSITIONS` | the **LINK** axis | §3 |
| `oxy_lifecycle.OxyRecState` + `REC_LEGAL_TRANSITIONS` | the **RECORDING** axis, independent of the link | §3, §7 |
| `oxy_transfer.flush_gate` | WAIT / PULL / ABANDON on `run_status` 3→2→1, deadline checked first | §9 |
| `oxy_transfer.close_harvest_decision`, `CLOSE_PULL_SCOPE` | the close decision; scope derived from trigger, never configured | §10 |
| `oxy_transfer.pull_deadline`, `GUARD_BAND_S`, `Deadline` | the abort deadline on a **monotonic** clock | §12, §23 |
| `oxy_inventory` DISCOVERED→COMMITTED, `identity()`, `reconcile()` | the transactional ledger + idempotency | §14, §16, §27 |
| `acq_evidence_o2ring.assemble_dat` | acquisition evidence | §30 |
| `capture.charger_pull_due` / `notworn_pull_due` | the two shipped event triggers | §17 |
| `capture.autopull_arming` | default-OFF arming that always states its reason | §20, §21 |
| `capture.adapter_kw()` | adapter identity by **MAC → current `hciN`**, resolved at use time | §22 |
| `pull_oxyii_session` | **the** downloader — presence never gains a second one | §14 |

**Nothing in this table was modified.** §36: *"Do NOT rewrite working Tepna code for stylistic reasons."*

### 2b · EXISTING → ADAPTED (two lines, both additive)

| component | change | why |
|---|---|---|
| `capture.pull_scope_for` | added `"presence" → "latest"` | see §3 below — this is a **correctness** edit, not a preference |
| `capture.charger_pull_poller` | a third `by_*` term + presence on the arming line | §14 — a new **trigger** on the existing dispatch |

### 2c · NEW → AND WHY IT IS NECESSARY

| component | why it could not be reused |
|---|---|
| `oxy_presence.OxyPresState` (**PRESENCE** axis) | the charter's §3 names **three** concepts; only two existed. ⚠️ `OxyState.NOT_SEEN` reads like absence and is a **LINK** state — deriving presence from it is the conflation §3 forbids |
| `oxy_presence.observe` + `is_expected_ring` | §5 debounce / gap tolerance / identity — no advertisement source existed at all (`AdvertisementData`, `detection_callback`: absent fleet-wide) |
| `oxy_presence.probe_justified` | §6/§11 — nothing decided *whether opening a link is justified*; the existing triggers assume the link |
| `oxy_presence.connection_plan` | §11/§12 — what happens **inside** one link. Binds the existing deadline **by injection**, so a second implementation is structurally impossible |
| `oxy_presence.arming` + `COEXISTENCE_KEY` | §20/§21 — *enabled* and *armed* must be separable while §2 is unrun |
| `capture.presence_fold` / `_presence_scan_loop` / `_maybe_start_presence_scan` | the observer shell |

### 2d · TESTS

**Reused:** the whole existing `oxy_transfer` / `oxy_lifecycle` / `oxy_inventory` suites — untouched,
and `connection_plan` is tested against the **real** `pull_deadline` and `flush_gate`, not fakes.
**New — 41 assertions**, `tests/test_oxy_presence.py` + `tests/test_presence_wire.py`, each named for
the failure it catches. Six planted controls verified by re-applying the defect.

## 3 · The one correctness edit, and the ruling it did NOT amend

`pull_scope_for`'s fall-through is `else "all"`, and `test_an_UNKNOWN_trigger_sweeps_rather_than_
narrowing` rules that this is **deliberate**: a narrow pull that misses a session loses data, a wide
one merely costs link time. **That ruling stands.**

It answers **data loss**. It says nothing about whether the pull **fits**. A presence-triggered pull
races the same closing window a doff does — the ring advertised, so it is awake on its post-session
tail — and §14b measured `which=all` at p90 **69.4 s** against a window it cannot make, versus
`latest` at p90 **31.1 s**. So the rule this adds is narrow: **a trigger that races a closing window
must name itself in the scope table rather than inherit.** Two orthogonal rules, both live.

## 4 · What is DELIBERATELY not done, and cannot be tonight

- 🔴 **§2's passive-scan coexistence matrix — NOT RUN.** The box is in DC. §2 forbids assuming a
  second BLE operation is harmless while O2Ring / CPAP / H10 / Verity may be acquiring, so **the code
  ships and the radio stays cold**: `scan_coexistence_verified` is a separate config key, default
  false, and the observer refuses to start without it. Arming it is a *measurement*, not an edit.
- **§25's A–O physical acceptance run — NOT RUN**, same reason. Those §34 checkboxes stay open.
- §19's T-chain witness telemetry and §35's full state machine are the next increment.

**Neither absence is papered over.** "Done by morning" means the deviceless system is complete and
gated; the permission to transmit is owed to a measurement nobody could take tonight.

## 5 · Standing ruling elevated out of this work

**BLE device identity on this host is ADDRESS-ONLY — never local-name matching, on any device path,
present or future.** A BLE local name is unauthenticated and attacker-controlled, so a name match
lets any device in range summon a GATT connection from this host and spend the shared radio's budget.
Recorded in `oxy_presence.py`'s docstring so the code defends itself.

## Done when

- [x] The PRESENCE axis exists, independent, with a disjoint vocabulary (gate-asserted).
- [x] Presence feeds the **existing** transaction as a trigger; no second downloader.
- [x] Default OFF, never inherited; enabled-vs-armed both reported.
- [x] Deadlines monotonic; the existing `pull_deadline` bound by injection.
- [x] 41 assertions, 100 % stmt+branch on the new module, six planted controls.
- [ ] §2's coexistence matrix run on the box → `scan_coexistence_verified` earned. **Thursday.**
- [ ] §25's A–O acceptance run with observed timestamps. **Thursday.**
- [x] §19's T-chain witness telemetry. **Stale-unchecked — SHIPPED in 90fea439 (#1846): `oxy_presence.witness_chain()`/`witness_summary()` over the 10-link `WITNESS_LINKS`, wired at `capture.py:7384-7386`, tests `test_oxy_presence.py:149-183`. Verified 2026-09-02.**
