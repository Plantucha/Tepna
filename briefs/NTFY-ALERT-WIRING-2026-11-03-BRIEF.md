<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — last-verified 2026-11-04) · **Created:** 2026-11-03

# Push alerts — how ntfy is wired, and how to add a new alert

The owner asked on 2026-11-03 for one brief that tells every session how the push alerts work. Read it before you write a new notification. It describes `origin/main` at commit `32dbd5f2`.

## 1 · The path of one alert

A capture-host alert goes through one object, `alerts.Notifier`, and one HTTP POST.

```
config.yaml  alerts.webhook_url + alerts.enabled (+ alerts.emails)
   │  main() in capture.py builds ONE Notifier and stores it in capture._NOTIFIER
   ▼
a poller sees an event  ──►  await notifier.send(title, message, key=…, dedupe_sec=…, now=…)
   │  send() appends the context footer (host, captures root, daemon, board thread)
   ▼
alerts.ntfy_publish(url, {"title","message"})   ntfy topic URL → POST to the server root with "topic" added
   │                                            any other URL (Discord, Slack, Home Assistant) → posted unchanged
   ▼
alerts._http_post  (aiohttp, 10 s timeout, 2xx = delivered)
   │
   ├──► the ntfy server ──► the owner's phone (and email, when send(email=True))
   └──► rig user unit ntfy-board-bridge subscribes to the same topic ──► agent-board thread "alerts: vigil"
```

The transport is a generic JSON webhook. ntfy is the transport the box uses. Nothing in `alerts.py` names the ntfy server, and the code never invents a destination.

## 2 · The parts

| part | where | what it does |
|---|---|---|
| `Notifier` | `capture-host/alerts.py` | `send()` posts one alert. It returns `True` only when the webhook answered 2xx. It never raises. |
| `ntfy_publish` | `capture-host/alerts.py` | Turns a one-segment topic URL into a root publish with `topic`, so the phone shows the title as a title. |
| dedupe | `Notifier.send(key=, dedupe_sec=, now=)` | Suppresses a repeat of the same key inside the window. `reset(key)` re-arms it. |
| email | `Notifier.send(email=True)` | Sends the `Email:` header for the first address. Addresses 2–5 go through the `<topic>-mail` topic. |
| delivery health | `Notifier.stats()` → `status.json` key `alerts` | Counts delivered, failed and suppressed alerts, the last title and the last error. The monitor page shows them. |
| the live notifier | `capture._NOTIFIER`, set in `main()` | Pollers get it as the `notifier` argument. Code that outlives `main()`'s arguments reads `_NOTIFIER` at call time (`_cpap_notify`). |
| config edit | `webmon.py` `GET/POST /api/alerts`, `POST /api/alerts/test` | The monitor's Push alerts panel. A change applies to the live notifier through `Notifier.configure`, with no daemon restart. |
| morning report | `capture-host/tepna-report.sh` | Builds its own `Notifier` from the same config. |
| board bridge | rig user unit `ntfy-board-bridge.service` (fleet unit, not in this repo) | Subscribes to the topics, latches episodes and posts each message to the mapped board thread. |

## 3 · The alerts that exist

| title | sender | trigger |
|---|---|---|
| `Tepna: capture started` | `main()` | The daemon starts. The text names the reason: boot, deploy, clean stop, exit code or crash (`alerts.start_reason`). |
| `Tepna: sensor offline` / `sensor recovered` | `alert_poller` | A configured sensor stays down for `alerts.offline_sec`. |
| `Tepna: sensor connected but silent` | `alert_poller` | A link is up and no data arrives. |
| `Tepna: <name> battery <pct> %` | `alert_poller` | 20 % and 10 %, re-armed at 50 % (`battery_alert_step`). |
| `Tepna: sensor on charger` | `alert_poller` | A device that had a `sensor offline` alert goes on its charger. |
| `Tepna: <name> night ended` | `alert_poller`, CPAP path | A stream ends in the morning after a real night, a device powers off after a completed pull, or a device goes on its charger after a wear of at least 1 h. |
| `Tepna: <name> not worn` | `alert_poller` | A device sends samples while its worn verdict stays False for `alerts.not_worn_sec` (600 s; 0 turns it off). |
| `Tepna: <name> streams on its charger` | `alert_poller` | Samples arrive after a device went on its charger. The text names the SDK mode. |
| `Tepna: ring identity mismatch` | `alert_poller` | The ring that connects is not the configured ring. |
| `Tepna: ring connects but serves nothing` / `ring serving again` | `alert_poller` | Three connects in a row deliver no frames. |
| `Tepna: packet-arrival sidecar dead` | `qc_poller` | The arrival sidecar stops. |
| `Tepna: disk low` | `storage_poller` | Free space falls below the floor. |
| `Tepna: a live capture file was lost` | `status_loop` | A file that was being written disappears. |
| `Tepna night QC` | `qc_poller` | The daily digest at the digest hour. |
| `Tepna: night has a gap` | `qc_poller` | A declared stream stays empty into the night. |
| `Tepna: a finished night is held open` | `archive_poller` | Device data is quiet, and a writer still holds the night open. |
| `Tepna: night <night> <status>` | `loss_poller` → `_announce_solid` | The solid-night verdict, once per night and status, after the night's band closes. |
| `Tepna: CPAP harvest failed` / `found nothing` | `_cpap_loop` | The CPAP card harvest fails or finds no data. |
| `Tepna: <label> crashed` | `keep_running` | A supervised task crashes and restarts. |

Run `git grep -n 'notifier.send\|_NOTIFIER.send' capture-host/capture.py` for the current list. This table can go stale.

## 4 · Add a new alert

1. Run Rule 0 for the event. An existing alert can already cover it.
2. Put the decision and the text in a PURE function in `alerts.py`. It takes plain values and returns a title and a message.
3. Start the title with `Tepna: `. Name the device and the night in the message.
4. Call `await notifier.send(title, message)` from the poller that sees the event. Guard with `if notifier:`.
5. Make the alert edge-triggered. Send once when the state starts, and once when it recovers.
6. Use `key=` and `dedupe_sec=` for an event that can flap.
7. Persist the latch beside the captures when a restart must not re-send. Use `_read_quiet_state` and `_write_quiet_state`.
8. Latch on `delivered or not notifier.enabled`. A failed send then retries on the next pass.
9. Use `email=True` only for an alert that needs action before the night is lost.
10. Write tests with a fake `_post`. Assert the title, the message and the latch.
11. Add a row to §3 of this brief in the same PR.

The test shape, from `capture-host/tests/test_alerts.py`:

```python
sent = []
async def fake_post(url, payload, headers=None):
    sent.append((url, payload))
    return True
n = alerts.Notifier(url="https://hook.invalid/topic", enabled=True, _post=fake_post)
```

## 5 · Rules

- The topic URL is a credential. Anyone who has it can read and post. Never put it in the repo, a PR, a commit, the board, a brief or a test. Display it only through `alerts.webhook_hint`, which removes the path.
- Never publish a test to a live topic. Tests inject `_post`. The monitor's test button is the owner's.
- An alert must never stop capture. `send()` catches every error, counts it and logs it. Do not add a call that can raise around it.
- `send()` logs a delivered alert at INFO and a failed one at WARNING. Do not remove either line. The log is the only record that an alert arrived.
- The bridge needs no change for a new alert on an existing topic. A new topic needs an entry in the bridge config on rig. That config is the owner's.
- A box change reaches the daemon only through a deploy. The owner authorises a manual deploy or restart. A merged capture-host PR deploys through the box update path.

## 6 · Open points

- The monitor's test button posts to the live topic. That is the owner's action, and the bridge posts it to the board too.
- The rig tools `release-land.mjs` and `estate-drift.mjs` treat an ntfy URL as a secret in their scans. They do not send alerts.
