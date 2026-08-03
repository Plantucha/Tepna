<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---
Every webmon error response is now asserted whole — a failed request could report `ok: true` to the monitor.

`make_app` holds the entire aiohttp route table, and 386 of `webmon.py`'s 395 surviving mutants lived
in it. The largest cluster was one shape: `{"ok": False, "error": …}` → `{"ok": True, …}`, surviving at
status 400, 409, 500 and 502 on every route. The tests asserted `resp.status`, and a few asserted
`body["ok"] is True` on SUCCESS paths — nothing read the body of a FAILURE. The browser branches on
`ok`, so a refused bond, a blocked CPAP pull and a config write that hit a full disk would all have
rendered as done.

Also closed: helper arguments discarded by `async def fake(*a, **k)` doubles (including
`bonding.forget(adapter_mac)`, which passes the ADAPTER as the address); the atomic config write's
sibling-temp mechanics, without which `os.replace` crosses filesystems and stops being atomic; the SSE
stream's headers, `_all` multiplex and filter direction; `cfg.get("devices", [])` with the default
dropped, invisible until a config has no `devices` key — a box before its first pairing; and six guard
inversions, including `enabled and tgt is not None` → `or`, which marks the archive enabled with no
target so the nightly offload runs against nothing and reports success.

No shipped source changed. Details in `audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md` § Fifth pass.
