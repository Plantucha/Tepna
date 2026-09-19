---
bump: minor
type: changed
brief: BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md
---

The clock-sync gate now keys on a MEASURED per-unit capability instead of a configured vendor string —
§1.3's first capability branch, so `devcaps` finally has a consumer.

Closes residue `2026-09-16-devcaps-has-no-branch-consumer`. **A capability branch must key on a measured
property, never on a configured label:** `is_polar` is a vendor string somebody typed into config, while
`fb005c51-…` in a unit's attribute table is what the device actually exposes.

## The blocker the row named had already dissolved

The row says *"no clock-sync capability probe exists; writing that probe is the unit that unblocks
done-when 1."* True on 2026-09-16 — and overtaken by the GATT map landing on 09-17/18. `run_polar`'s own
comment names the capability (*the sync "fails on a missing characteristic"*) and `polar_psftp.MTU_CHAR`
names the characteristic, so discovery already measures it. **No probe had to be written.**

## Why it is a producer plus a reader rather than a direct read

The clock sync runs **before `_connect`**, so no Database Hash is in hand and `gattmap.expected()` — the
hash-keyed accessor — is unusable there. The only hash-free accessor is `wait_hint()`, whose docstring
forbids exactly this use: *"never an assertion about correctness … must never reach a code path where
being wrong is silent."* Skipping a clock sync on a stale hint **is** a silent-wrong path: the clock stays
uncorrected and nothing says so. That eliminates the direct read, and what remains is forced rather than
chosen:

> **write the capability where the hash is valid, read it where no hash is needed.**

`_gatt_record_table` derives `devcaps.record(addr, "psftp", …, source="gatt-mtu-char")` at the moment it
records the table; the branch reads `devcaps.get(addr, "psftp")` pre-connect, which needs no hash and is
already tri-state. That difference in *validity requirements* is also the real reason `devcaps` exists
separately from `gattmap` — which the row asserted without giving one.

The derive runs on **every accepted outcome including `"same"`**, deliberately: `"same"` means the *table*
was already stored, not that the capability was, so a unit recorded before this landed would otherwise
stay unmeasured until its firmware happened to change. A refusal (`""`) derives nothing — a capability
from a rejected table would be a fact with no evidence behind it.

## `None` is not `False`, and that asymmetry is the whole safety argument

`clock_sync_capable(psftp, is_polar)` returns the measurement where one exists and the vendor string only
while unmeasured. Writing `bool(psftp)` would coerce unmeasured to "incapable" and silently stop writing
the clock on every device not yet in the map — the defect `devcaps.get` exists to refuse.

So **only units we have measured can change behaviour**, which is safety by construction rather than a
bounded blast radius. The one new behaviour: a unit exposing PS-FTP but configured `vendor != "polar"`
now gets a clock sync it does not get today — a misconfiguration being fixed, still guarded by the
charging and give-up rules.

**Inert for the two units currently recorded** — not "inert on this box". `gattmap.json` holds the
Polar-OUI unit (has the characteristic, configured polar) and the AS11 (lacks it). H10 and O2Ring are not
in the map yet, so the honest statement is scoped to what has been measured.

## The rollout is logged, because it is distributed over time

As the map fills, each newly-recorded unit moves from vendor-string logic to measured logic with nothing
marking the transition — a behaviour change invisible at every individual step and the hardest kind to
attribute afterwards. `_clock_gate` logs which branch decided, **on basis change only**: the gate is
evaluated every ~70 s reconnect, and a line per evaluation buries the event instead of surfacing it (the
same reasoning `_gatt_record_table` already records for its `"same"` outcome).

## Scope held

`needs_pmd` and `optional` stay out, as the row instructs — configuration, not hardware. The `is_polar`
re-bond gate is **untouched**: bonding is not gated by PS-FTP presence, and converting it would be a
second decision wearing the first one's evidence. `_has_contact_bit` is untouched too — it is a *session*
fact, and seeding it from a record would coerce `None → False`, which is the defect this branch avoids.

## Tests

7 added, and each guard was **mutation-verified to discriminate**:

- coercing the tri-state to `bool(psftp)` → **2 failed** (the unmeasured-fallback arm and the log test);
- gating the derive on `("new","changed")` → the backfill test fires;
- logging on every evaluation instead of on change → the log test fires.

Plus a drift guard pinning `capture.PSFTP_MTU_CHAR` to `polar_psftp.MTU_CHAR`, since the literal is a copy
(`polar_psftp` pulls bleak; `import capture` stays stdlib-clean for CI) and an unguarded copy measures
nothing once it drifts. `clock_sync_due`'s first parameter is renamed `is_polar` → `capable`; its existing
tests call it positionally and are unaffected.
