<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: O2RING-PRESENCE-TRIGGER-IMPL-2026-08-26-BRIEF.md
---
Add the O2Ring PRESENCE axis and wire it as a third trigger on the existing .dat harvest — shipped cold until the coexistence matrix runs.

The autonomous-harvest charter names three concepts that must stay independent: presence, connection,
recording state. Two already existed and are lead-ratified (`oxy_lifecycle`'s LINK and RECORDING
axes). This adds the third — presence, meaning the ring was observed advertising, which is NOT a
connection and NOT proof of a recording.

⚠️ `OxyState.NOT_SEEN` reads like absence and is a LINK state. Deriving presence from it is the
conflation the charter forbids, and the same fleet trap the RECORDING axis was split out to escape.

Presence enters as a THIRD `by_*` term on the existing `charger_pull_poller` dispatch — the same
`pull_oxyii_session`, the same transaction, never a second downloader. It takes `which=latest`
because it races the same closing window a doff does; the existing "unknown trigger sweeps everything"
ruling is untouched, because that one answers data loss and this one answers whether the pull fits.

🔴 It ships COLD. `scan_coexistence_verified` is a config key separate from `enabled`, because
enabling a feature must not amount to asserting a hardware measurement nobody ran: the charter
requires passive scanning be tested against live CPAP/H10/Verity acquisition first, and the box is
away. Both switches must be on before the radio is used, and the daemon reports enabled-but-unarmed
as its own state rather than as "off".

Standing ruling elevated fleet-wide: BLE device identity is ADDRESS-ONLY, never local-name matching.
A BLE local name is unauthenticated and attacker-controlled, so a name match would let any device in
range summon a GATT connection from this host and spend the shared radio's budget.
