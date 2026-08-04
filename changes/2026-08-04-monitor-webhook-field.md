<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md
---

Set the push-alert webhook from the monitor — Settings → Push alerts (VIGIL-OBSERVED-ERRORS E6,
out-of-suite `capture-host/`).

E6's alert half had been open since 2026-07-20 for the reason headless boxes always stall: the only way
to set `alerts.webhook_url` was hand-editing `config.yaml` over SSH, so the low-disk and sensor-offline
alerts fired to nobody. Measured on the live box 2026-08-04: no `alerts:` key at all.

`GET/POST /api/alerts` + `POST /api/alerts/test`, and a card in the Settings view. The change applies to
the RUNNING notifier via `Notifier.configure()`, so setting it costs no restart and drops no BLE links
mid-night.

⚠️ The field is WRITE-ONLY by design. For ntfy / Discord / Slack / Telegram the URL *is* the bearer
credential, and the monitor is LAN-reachable through Caddy, so the API returns `{enabled, configured,
hint}` and never the URL — `hint` is scheme://host with the path (the token) stripped. Same rule
`storage_targets` already states for passwords, and the reason the key is deliberately NOT in
`settings_schema.SETTINGS`: `/api/settings` echoes every value it owns straight back to the client.
Omitting the field on save KEEPS the stored URL (the input necessarily renders empty, so treating
"absent" as "delete" would wipe the destination on every checkbox toggle); `""` is the explicit clear.

`configure()` clears the dedupe ledger on a real change — those timestamps mean "the operator has
already been told", which is only true of the previous destination, and the first alert to a new
endpoint is exactly the one they are waiting for. An idempotent re-save leaves it intact so Save-twice
is not a dedupe bypass.

Verified by re-applying the defect: 10 mutants, all killed — including GET leaking the URL, the hint
returning the full URL, absent-means-clear, enabled-without-a-URL, the scheme allowlist removed, the
notifier not re-pointed, and a save failure reported as success.
