---
bump: patch
type: security
brief: none
---

# 2026-10-05 — No-network gate fail-closed (§3)

## What
The no-network gate (`no-network.html`) had fail-open issues at the privacy boundary:
1. The `provenance/index.json` fetch silently fell back on failure (`catch(_){}`) — a gate
   that cannot verify the authoritative bundle list passed anyway.
2. `BUNDLES_FALLBACK` omitted `MotionDex.html` (review M1).
3. The Python lens scanned only `capture-host/` and did not check for missing timeouts.

## Fix
`no-network.html`:
- Provenance fetch is fail-closed: a throw or empty response sets `bundleListError`, and
  `staticOK` requires `bundleListError===null`. The error is attached to the verdict via
  `noNetworkStatus().bundleListError`.
- `MotionDex.html` added to `BUNDLES_FALLBACK`.
- Python lens widened: `tools/ble-jitter-probe.py` added to `PY_FILES`.
- New `PY_NO_TIMEOUT` lens: any `requests.*`/`urllib.request.urlopen`/`urllib3`/`httpx`
  call without an explicit `timeout=` is a FAIL. `socket.setdefaulttimeout` does not count —
  the timeout must be explicit on the call. Missing-timeout hits are added to `pyEgressTotal`,
  failing the gate.

Note: the §3 brief named `tools/net-guard.mjs`, which does not exist in the repo (never has).
The actual no-network gate is `no-network.html`; the fail-open fixes were applied there.

## Tests
`tests/dex-tests.js` group `no-network gate fail-closed — provenance fetch + Python timeout lens (§3)`:
- RED: original `no-network.html` has 0 occurrences of `bundleListError`, `PY_NO_TIMEOUT`,
  or `MotionDex.html` — all assertions fail.
- GREEN: all 7 assertions pass — fail-closed provenance fetch, MotionDex in fallback,
  PY_NO_TIMEOUT regex compiles, bare `requests.get(url)` flagged, explicit timeout not
  flagged, `socket.setdefaulttimeout` does not satisfy.

## Verification
- `npm run typecheck`: pass
- `no-network.html` is not bundled (standalone gate page, no rebuild needed)
