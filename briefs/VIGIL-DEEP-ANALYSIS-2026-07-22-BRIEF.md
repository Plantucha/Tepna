<!--
  VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-22

_Deep analysis of the Vigil bedside capture appliance — the monitor/control server, the in-browser live
detectors, the BLE capture supervisor, and the bonding/BlueZ layer — plus detector-algorithm, robust-BLE,
similar-project, and minimal-hardware research. Executes against the field record in
`VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md`; feeds work into `CAPTURE-HOST-2026-06-29-BRIEF.md`. Out-of-suite
(`capture-host/`, Python + a served HTML monitor) — no Dex bundle / `manifestHash` / provenance impact._

# Vigil deep analysis — errors, better detectors, robust Bluetooth, minimal hardware

**How this was produced (and verified).** A multi-agent pass (5 code auditors over `webmon.py` /
`monitor.html` / `capture.py` / `bonding.py`+`link_rssi.py` / the 17-brief context set · 5 research agents on
ECG/PPG detection, robust BLE, prior art, and hardware · an adversarial verifier that rejected 22 of 40
proposals and a synthesizer). **Every HIGH finding below was then independently re-verified against the
actual source by the author** (the automated verifier ran while its safety classifier was unavailable, so
the code claims are not taken on the agents' word). Line numbers are as of 2026-07-22 `main`; treat them as
anchors, not exact addresses after any edit. Already-shipped work is collected in §7 so it is not re-proposed.

---

## 1 · Executive summary — highest-leverage changes, ranked

1. **Bound every post-connect GATT setup await** (`capture.py:762` + `727/737/865/871/1115/1347/1350/1368`).
   The single most severe correctness hole. The file states its own invariant — *"EVERY BLE await must be
   bounded"* (`capture.py:126`) — and honors it for `connect()`, but **not** for `start_notify` /
   `read_gatt_char` / auth-writes in any of the three runners. **Verified:** `run_oxyii` calls
   `_set(connected=True)` at `:1204`, then `start_notify` (`:1347`) + three `write_gatt_char` auth/setup
   writes (`:1348/:1350/:1368`) with no `wait_for` — the first bounded await is the poll-loop `live_frame`
   at `:1387`, which is only reached *after* those writes. A BlueZ wedge landing after `connect()` parks a
   task at `connected=True` forever: the stall watchdog sits later in the loop and is never reached,
   `classify_adapter_health` sees `connected=True` (not a phantom → no power-cycle), `alert_poller` keys on
   `connected` (no offline alert), `sd_watchdog` keeps beating (the loop is fine). One device frozen all
   night, zero rows, everything green.
2. **Replace the window-max detector threshold with a robust/adaptive one** (`monitor.html:1372-1385`
   `detectRs`, `:1501-1503` `detectPulses`). **Verified:** `detectRs` sets `thr = 0.55·amax` where
   `amax = max|s−mean|` over the 5–7 s buffer; `detectPulses` sets `thr = 0.4·smax` over the first-difference
   max. One electrode pop / motion spike / finger-move — the routine overnight condition — inflates the max
   so the threshold sits above every real complex and HR reads "—" or wrong for the whole window. The core
   live-view robustness defect.
3. **Move the adapter pin + RSSI off deprecated `hcitool` to D-Bus** (`link_rssi.py:63-72`). **Verified:**
   `resolve_hci()` maps the configured adapter MAC → `hciN` *solely* via `hcitool dev` (`:72`), and its own
   comment (`:90`) asserts this is "the ONLY path that can work on the Pi." `hcitool` was deprecated in
   BlueZ 5.44+ and is not installed by default on current Raspberry Pi OS — absent → falls back to the BlueZ
   default radio = the 2026-07-18 mis-pin class (capturing over the deaf onboard radio all night). Internally
   inconsistent: `bonding.py:106` already pins the same adapter by MAC via `bluetoothctl select`, no hcitool.
4. **Stop leaving every sensor `Trusted`** (`bonding.py:190`). **Verified:** `bond()` issues
   `trust {address}` (`:190`) and there is **no `untrust` anywhere in the tree**. A bonded+trusted device
   makes the BlueZ kernel launch its *own* background reconnect on re-advertise, racing bleak for the single
   ACL slot — the recorded "trusted auto-reconnect fight" and a source of `br-connection-canceled` /
   `org.bluez.Error.InProgress`. Trust is not needed for Just-Works GATT sensors; `_CONNECT_LOCK` orders
   bleak's connects, not the kernel's.
5. **Make the byte-stall watchdog per-stream, not collective** (`capture.py:907`). `rows_now != last_rows`
   resets the stall timer for **all** streams if **any** one advances, so a single dead PMD stream behind a
   live sibling (the 2026-07-19 ECG-flowing-while-ACC-at-zero class) is never detected. The shipped stall
   watchdog (E1) is real but collective; making it per-stream is a genuine extension, not a re-proposal.

Supporting these: MAC-format validation at the bonding boundary, honest config-persist failures, a real
per-window SQI gate on the live rate path, and moving the honest ECGDex R-peak leg off classic Pan-Tompkins.

---

## 2 · Code defects found (excluding already-shipped — see §7)

Severity is for **unattended-overnight reliability + live-view correctness**, not clinical accuracy (the
monitor is never the record; disk is — Clock Contract). Each carries `file:line` + a fix.

### 2A · Monitor / control server (`webmon.py`, `telemetry.py`)

- **[HIGH] `/api/polar/recordings` is a GET, bypassing the POST-only token gate while pausing overnight
  capture** — `webmon.py:471` (route), `:43` (auth). **Verified:** `_auth` gates only `request.method ==
  "POST"` (`:43`); `web.get("/api/polar/recordings", …)` (`:471`) reaches `_polar_run` → `polar_pause()`
  (pauses that Polar's live capture) + `bonding.ensure_bonded` (~20 s bluetoothctl scan/pair) + a PS-FTP list
  over the single radio. An unauthenticated LAN client can interrupt overnight capture and seize the radio
  *despite* `web.token` being set. *Fix:* treat radio-contending ops as state-changing regardless of verb —
  make `polar_recordings` a POST behind the token (or require the token for `/api/polar/*` + `/api/pull`);
  keep only genuinely read-only GETs open (`/api/state`, settings/clock GET, `/api/stream`).
- **[MED] Device address reaches the bluetoothctl REPL with no MAC-format validation — newline injection** —
  `webmon.py:118` → `bonding.py:190`. **Verified:** `bond`/`forget`/`remember` forward `body["address"]`
  straight into `bonding.*`, which f-string-interpolate it into a newline-delimited bluetoothctl stdin script
  (`f"trust {address}"` `:190`, `f"info {address}"` `:149`). An address like `AA:BB:…:FF\npower off` or
  `…\nremove <other-sensor>` injects privileged control commands. `_ADDR_RE` exists but is applied only to
  scan *output*, never control *input*. LAN-only + token-gatable, so severity MED — but `remember` persists
  an arbitrary address to `config.yaml`, deferring the same injection to next connect. *Fix:*
  `re.fullmatch(r'[0-9A-Fa-f:]{17}', body.get('address',''))` → 400 at the webmon boundary in `bond`,
  `forget`, and `remember` (before persisting); use `body.get(...)` not `body[...]` (a missing key is a 500).
- **[MED] `_save()` swallows all write errors; endpoints report `ok:true` on a failed config persist** —
  `webmon.py:210`. **Verified:** `_save` wraps the write in `except Exception: pass`. On a full/read-only
  disk (the recorded E6 "no acting guardrail" case) the write silently fails yet `remember`/`settings_post`/
  `forget` return `{ok:True}`. In-memory `cfg` reflects the change so the running daemon behaves — but
  nothing is on disk, and it vanishes on the next restart. *Fix:* `_save()` returns True/False; on failure
  return `{'ok':False,'error':'config write failed (disk?)'}` status 500 from all three callers.
- **[LOW] Unguarded `await req.json()` → 500 on a malformed/empty body** — `webmon.py:119` (and `:132/:224/
  :235/:319/:434`). Inconsistent with `pull_stored_h` (`:193`) and `timesync` (`:382`), which already guard;
  `test_pull_tolerates_a_malformed_json_body` asserts "not 500" for the one guarded path. *Fix:* a `_body(req)`
  helper (`await req.json() if req.body_exists else {}`, try/except → `{}`) across all POST handlers, then
  explicit-400 on missing required keys.
- **[LOW] Shutdown-sentinel path has a false load-bearing comment and no test** — `webmon.py:64`. The
  `_on_shutdown` comment claims "an unbounded Queue's put_nowait cannot fail," but the queue is **bounded**
  (`asyncio.Queue(maxsize=64)`, `telemetry.py:163`), so `put_nowait` *can* raise `QueueFull` — the `except`
  is load-bearing and the reasoning is false. The path still exits (full queue drains, `_shutting_down` breaks),
  so it survives on a false premise. This is the fix for the 101 s SIGTERM hang (E2) and has **no test** —
  `test_start_binds_and_cleans_up` cleans up with no open stream. *Fix:* correct the comment; add a test that
  opens `/api/stream/_all`, runs `on_shutdown`/`runner.cleanup()`, and asserts return within a keep-alive.
- **[LOW] Synchronous config I/O on the BLE event loop** — `webmon.py:212` (+ `shutil.copyfile` `.bak` at
  `:372`). Fires only on human control actions, not during unattended capture, so impact is minimal. *Fix:*
  optional `run_in_executor` hardening; acceptable to leave with a note.

### 2B · In-browser live detectors (`monitor.html`)

- **[HIGH] R-peak/pulse thresholds are a fixed fraction of the WINDOW MAX — one artifact blinds the detector
  for the whole window** — `monitor.html:1372-1385` (`detectRs`), `:1501-1503` (`detectPulses`). See §1.2.
  No adaptive threshold, no decay, no robust scale, no searchback. *Fix:* robust adaptive threshold —
  `k·MAD` / percentile-of-local-maxima scale, or the light Pan-Tompkins the comments already imply (HP →
  5-tap derivative → square → 150 ms integrate → dual adaptive `SPKI/NPKI` + searchback at 1.66×RR). A few
  dozen lines of plain JS.
- **[MED] `detectRs` keys on raw amplitude with a 300 ms refractory — T-waves/baseline wander can double the
  HR** — `monitor.html:1369-1385`. **Verified:** no bandpass/slope emphasis; global window mean is the only
  baseline; `refr = 0.3·fs = 300 ms` sits right at the R→T interval, so a tall peaked T-wave on the H10
  single differential lead just past 300 ms counts as a second peak → alternating short/long IBIs → doubled
  HR. *Fix:* detect on a slope/energy signal, add T-wave discrimination (reject a candidate within ~360 ms
  whose max slope < ~0.5× prior QRS slope), replace the global mean with a running-median/high-pass baseline.
- **[MED] Buffer is GAP-blind — a dropped-packet gap fabricates a short IBI and a wrong HR** —
  `monitor.html:1153-1156, 1194, 1331-1334` (same in `analyzeBeats` `:1392`, `analyzePulse` `:1527`). SSE
  sample arrays are concatenated into a flat ring with only a scalar `fs`; IBIs come from sample-index
  deltas. Across a dropped-packet gap (reconnect storms, non-monotonic phone stamps — both recorded field
  errors) the two straddling samples are adjacent in the buffer but seconds apart in wall time → one
  artificially short IBI → transient wildly-high HR right after every reconnect. Violates the *spirit* of the
  Clock Contract gap rule. *Fix:* carry each packet's arrival/sensor `tMs` (the daemon already stamps it),
  mark gaps where inter-packet Δt exceeds samples/fs, and discard any IBI spanning a gap boundary.
- **[MED] No missed/extra-beat reconciliation — median IBI silently halves or doubles the rate** —
  `monitor.html:1193-1197, 1391-1394, 1526-1529`. Rate = `60000/median(IBI)`. Median is robust to a
  *minority* of wrong beats but not a *systematic* one: miss every other beat (fading overnight signal) → HR
  halves; T-wave doubling → HR doubles. *Fix:* before the median, split IBIs ≈2× (insert implied missed
  beat) and merge/reject IBIs ≈0.5× (drop the extra), then median the corrected series. ~12 lines.
- **[MED] A trusted-but-degraded stream freezes the last HR on screen with no staleness cue** —
  `monitor.html:1181-1199, 1212-1215`. `ovRates` writes `st.rate` only when it finds ≥3 peaks with an
  in-range median; otherwise it leaves the last value. "weak" streams are `trust:true` (`:577`), so a worn
  sensor degrading to <3 detectable beats keeps rendering the LAST HR indefinitely — overnight, a frozen HR
  is visually indistinguishable from a live one. *Fix:* stamp `st.rateAt=now` on every update; render muted
  `(stale)`/age or "—" when `now − st.rateAt > ~4 s`.
- **[MED] PPG foot detection weak on long/broad crests — fixed 400 ms back-window + plain argmin** —
  `monitor.html:1531-1534, 1552`. Foot = min over a fixed `[p−0.4·fs, p)`; on a broad/slurred upstroke (cold
  periphery — routine overnight) the true foot lies further back so the search truncates, and argmin latches a
  wandering-baseline trough. (The systolic-peak cap was *already* fixed to IBI-aware `0.6·IBI` at `:1554-1560`
  — the foot half is not.) This is `CAPTURE-HOST-FOLLOWUPS-I §4.2` still open. *Fix:* detrend (subtract a
  moving-median), locate the foot by intersecting tangents / max of the second derivative within
  `[prev-peak, peak]`, bound the back-search by the running IBI.
- **[MED] SpO₂/PR "session summary" is really a ~30-min rolling window** — `monitor.html:1280, 1620-1687`.
  `oxiSpo2/oxiPr` are capped at `OXI_CAP=1800` samples ≈ 30 min at 1 Hz, yet rows read "SpO₂ nadir (min)",
  "Time <90% (session)", and the panel title is "session summary." On an unattended night the true nadir or
  an earlier desat cluster has scrolled out, so the "session" figures under-report. *Fix:* keep true
  whole-session accumulators (running min/max, Welford mean, `<90`/`<88` counters) independent of the display
  ring; feed the table from those and keep the 1800-ring only for the sparkline. Or relabel "(last 30 min)".
- **[LOW] Averaged-beat ensemble aligns on integer peak index only** — `monitor.html:1396-1406, 1532-1544`.
  ±1–2 sample jitter (≈8–15 ms at 130 Hz) blurs the ensemble, widening QRS and lowering the reported peak
  amplitudes. The `corr>0.8/0.85` second pass rejects shape outliers but doesn't correct alignment. *Fix:*
  fine-align each window to the first mean by max-xcorr lag (±3–4 samples) before the second average. Low
  priority — amplitudes are already labelled uncalibrated/experimental.

### 2C · BLE capture supervisor (`capture.py`, `polar_pmd.py`, `oxyii.py`)

- **[HIGH] Post-connect GATT setup awaits are UNBOUNDED in all three runners** — `capture.py:762` (+ `727,
  737, 865, 871, 1115, 1347, 1350, 1368`). See §1.1 — verified against source. *Fix:* wrap every post-connect
  setup await in `asyncio.wait_for` with a dedicated bound (`_BLE_SETUP_TIMEOUT_S` ~ `_PMD_CTRL_TIMEOUT_S`…10 s);
  a timeout must raise out of the `try` so `except/finally` close the writers and the loop retries on a fresh
  link.
- **[MED] Byte-stall watchdog is collective (OR across streams)** — `capture.py:907`. See §1.5. The docstring
  (`:469`) even says "has EVERY started stream been silent" (AND), but the code is OR. The NO_ACK "the stall
  watchdog will re-negotiate" path (`:841-854`) only holds for single-stream devices. *Fix:* track
  `last_change` per writer; trip when ANY started stream is silent > `_STREAM_STALL_S` while the link is up
  (or re-negotiate just the silent stream). Keep backoff-reset on aggregate flow.
- **[MED] `on_pmd` catches only `ValueError` — a truncated/empty PMD frame raises `IndexError`/`struct.error`
  into the bleak callback** — `capture.py:661`, `polar_pmd.py:248`. `data[0]` on a 0-byte notification raises;
  `_decode_delta`'s reference read reads `channels*ref_bits` bits with no payload-length check. Not
  `ValueError`, so it escapes; bleak logs+swallows callback exceptions (lost frame + spam), and if systematic
  the stream produces zero rows, masked by a live sibling (per above). *Fix:* broaden `on_pmd` to
  `except Exception`, add a payload-length guard in `decode_frame` before `_decode_delta`.
- **[MED] `adapter_watchdog` permanently disarms L2 after `max_adapter_cycles`** — `capture.py:1687`. After
  the default 3 failed power-cycles it logs CRITICAL and `continue`s forever. A wedged adapter doesn't wedge
  the loop (connects just time out), so `sd_watchdog` keeps beating, `WatchdogSec` never fires,
  `Restart=always` never triggers. Box spends the night reconnect-and-timeout, zero live bytes, believing it
  is healthy — blast radius capped only by onboard recording. *Fix:* after exhausting cycles, escalate to a
  clean non-zero process exit (`set _STOP`, return failure) so systemd re-execs with a fresh bleak/D-Bus
  stack; gate behind `watchdog.exit_on_giveup`.
- **[MED] Auto-pull fires on a transient "not worn" and holds the global connect lock through a multi-session
  pull** — `capture.py:2152`. The docstring promises a "morning window after the ring comes off," but the gate
  is only `if connected and worn is True: continue`. A ring off for a 3am bathroom break reads `worn=False` →
  `pull_oxyii_session(which='all')` sets `_OXYII_PAUSE` and holds `_CONNECT_LOCK` for the whole download
  (bounded 300 s). Any H10/Verity link dropping in that window can't reconnect until the pull finishes. *Fix:*
  require the ring continuously off-finger for a settle window (`_WORN_SINCE`) and/or no other device
  streaming, before auto-pulling — or a configured morning window. Keep manual pulls unrestricted.
- **[LOW] `status.json` / `QC-SUMMARY.json` written non-atomically** — `capture.py:1581, 2052`. `open('w')` +
  `json.dump` every 10 s; webmon serves the file. A read interleaved with truncate+write, or a SIGKILL
  mid-dump, yields partial JSON. *Fix:* write to a temp sibling then `os.replace()` (atomic rename). One line.
- **[LOW] `_now()` re-anchors on any >2 s monotonic-vs-wall divergence** — `capture.py:109`. A gradual chrony
  slew or `CLOCK_MONOTONIC` pausing across suspend crosses 2 s as *accumulated* drift and gets relabelled a
  step. Re-anchor is honest (offset frame preserved); concern is log noise + small stamp discontinuities.
  *Fix:* optional — distinguish rate-divergence (slew, absorb) from an instantaneous jump (step, re-anchor)
  via drift-velocity across two calls; or raise `_STEP_THRESH_S` / rate-limit the warning.
- **[LOW] No awareness of the adapter's simultaneous-connection ceiling** — `capture.py:307/383`.
  `_CONNECT_LOCK` serializes establishment but nothing caps/tracks concurrent live links; a ceiling error
  (`br-connection-profile-unavailable` / "Too many") isn't in `_TRANSIENT_BLE`, so it looks like "sensor off."
  *Fix:* classify connection-limit substrings distinctly; log live-link count at boot / on a ceiling error.

### 2D · Bonding / BlueZ inference (`bonding.py`, `link_rssi.py`)

- **[HIGH] Adapter pin + RSSI depend on deprecated `hcitool`; on Pi 5 it silently falls back to the wrong
  radio** — `link_rssi.py:63-72`. See §1.3 — verified. *Fix:* resolve MAC→`hciN` over D-Bus (ObjectManager:
  enumerate `Adapter1`, match `Address`, take the `/org/bluez/hciN` leaf) or parse `bluetoothctl list`; keep
  hcitool only as a last-resort RSSI fallback; log CRITICAL (not warning) when no method resolves a configured
  adapter.
- **[HIGH] `bond()` leaves every sensor `Trusted` — the mechanism behind the recorded auto-reconnect fight** —
  `bonding.py:190`. See §1.4 — verified (no `untrust` in-tree). `_TRANSIENT_BLE` (`capture.py:383`) doesn't
  even list `br-connection-canceled`, so the symptom isn't recognized. *Fix:* drop persistent trust (remove
  the `trust` line, or append `untrust {address}` after "Pairing successful") so bleak is the sole ACL
  initiator; add `br-connection-canceled`/`connection-canceled` to `_TRANSIENT_BLE`.
- **[MED] No GATT service-cache invalidation on a stale/empty characteristic table** — `capture.py:1123` /
  `:1206`. BlueZ caches the GATT DB on disk for bonded devices; after a firmware update / factory reset /
  truncated discovery the cache can miss the vendor service, and reconnect reuses the same stale cache →
  infinite reconnect→stale→stall→reconnect. Comments at `:1087/:1205` name the hazard; nothing acts. *Fix:*
  on a device that SHOULD expose a service but doesn't, force fresh discovery (`ensure_bonded(force=True)` /
  clear on-disk attributes), per-address retry-counted so it fires once per stale episode.
- **[MED] O2Ring active `BleakScanner` runs on the shared adapter OUTSIDE `_CONNECT_LOCK`** —
  `capture.py:344`. `_connect_scan` runs `find_device_by_filter` (active scan, up to 15 s) *before* acquiring
  `_CONNECT_LOCK` (`:351`). Active scanning while holding streaming ACL links steals air-time (a known cause
  of degraded BLE on one controller) and can itself surface `InProgress`. The churniest device opens this
  window most often. *Fix:* move the scan inside `_CONNECT_LOCK` (scan and connect mutually exclusive on the
  radio); shorten it; prefer `scanning_mode='passive'` (the ring's advert is enough).
- **[MED] Adapter power-cycle is a soft `power off/on` that may not reset a firmware-wedged dongle** —
  `capture.py:1698`. A soft toggle (rfkill/mgmt) doesn't re-enumerate or firmware-reset the USB device; the
  RTL8761B signature failure is a firmware hang the toggle doesn't clear — the radio returns "powered" but
  deaf, and the ladder burns all cycles on ineffective toggles. *Fix:* add stronger tiers before give-up —
  `hciconfig hciN reset` (mgmt reset), then USB unbind/rebind (`/sys/bus/usb/drivers/.../unbind`+`bind`) or
  `btmgmt reset`, under the existing `CAP_NET_ADMIN`. Order gentlest-first.
- **[LOW] `is_bonded()` treats "Paired: yes" as bonded** — `bonding.py:150`. For LE, Paired (transient) can
  lack the stored long-term keys of Bonded; a "Paired-but-not-Bonded" state treated as bonded skips the
  re-pair, and the strap keeps dropping discovery. *Fix:* gate the fast path on `Bonded: yes` specifically.
- **[LOW] `bond()` is a blind fixed-delay script with no early-exit on advert** — `bonding.py:191`. Hardcodes
  `scan on` then a 9 s wait before `pair`; the ring/Verity advertise only in short bursts, so a 3am re-pair
  can fire `pair` into a gap → "not available" though present. *Fix:* watch bluetoothctl for
  `[NEW]/[CHG] Device <addr>` then pair (reuse the live path's early-exit logic), with an overall cap.

---

## 3 · Better detector implementation (in-browser, no deps, no network, deterministic)

The monitor's live detectors are the weakest-verified code in the box; disk-of-record analysis is the Dex
suite's ECGDex/PpgDex. Two tracks: the **live browser JS** (§2B) and the **ECGDex honest-H10 leg**.

### 3A · ECG R-peak
- **Live view: stop thresholding the RAW trace.** Insert a cheap 5–15 Hz 2nd-order IIR bandpass before
  `detectRs`, OR replace it with **Elgendi's two-moving-average (TERMA)** stage (integration-window MA +
  beat-window MA, two knowledge-based thresholds). Cheap per-sample, streams trivially, documented
  noisy-condition winner. *Elgendi M (2013), Fast QRS Detection with an Optimized Knowledge-Based Method,
  PLOS ONE 8(9):e73557 — F1 99.82% over 109,985 MIT-BIH beats.*
- **ECGDex (disk record): move the honest H10 leg off classic Pan-Tompkins.**
  - *First choice:* **EngZee / Engelse-Zeelenberg** (Lourenço 2012 real-time modification) — the clear top
    performer on noisy single-lead in the JF stress test. Reference `berndporr/engzee_ecg_detector` is
    **GPL → clean-room re-implement** (suite is Apache-2.0).
  - *Lower-effort in-family:* **Pan-Tompkins++** (Imtiaz & Khan 2022, IEEE BIBM; arXiv:2211.03171) —
    −2.8% FP, −1.8% FN, +2.2% F, −33% runtime vs classic PT; reference is MIT-licensed Python → port to JS.
  - **Add parabolic sub-sample R-peak interpolation** either way: detector jitter shifts SDNN/RMSSD, which
    ECGDex feeds. *(Scientific Reports 2026, s41598-026-49215-6 — different validated detectors yield
    statistically different HRV from sub-sample fiducial placement.)*
- **Why not classic Pan-Tompkins as the benchmark:** *Porr & Macfarlane (2024), PLOS ONE 19(11):e0309739* —
  PT scored only **75.3 ± 19.1** on the JF test even on clean sitting data, well below EngZee/Elgendi/WQRS;
  EngZee was "the clear winner for noisy ECGs." **Gate any ECGDex switch on a real tri-device-corpus (20
  nights, H10-01) A/B, not MIT-BIH** — a corpus win, not a paper win.

### 3B · PPG pulse (Verity green ~55 Hz, O2Ring pleth ~125 Hz)
- **Replace `detectPulses` with a downsampled multi-scale trough detector — MSPTD / MSPTDfast recipe.**
  Decimate to ~20–30 Hz, keep only scales for HR > 30 bpm; threshold-free, foot-AND-peak, robust to broad
  crests + autogain steps by construction. *Charlton PH et al. (2022), Detecting beats in the PPG:
  benchmarking open-source algorithms, Physiol Meas 43, 10.1088/1361-6579/ac826d (MSPTD top-ranked F1); speed
  lever MSPTDfast v.2, Charlton 2025, 10.1088/1361-6579/adb89e — ~3× faster, 0.1% F1 loss.* Reference is
  MATLAB → reimplement the public method (plain array math, no FFT/deps).
- **Port PpgDex's offline cadence-adaptive refractory + sub-harmonic guard into the live detector,** replacing
  the fixed 0.4 s refractory (150 bpm ceiling, no doubling protection), so live bpm tracks the disk analysis.
- **Band-pass the live window (0.5–8 Hz, edge-padded zero-phase) before detection/SQI** — removes DC/drift and
  terminal ringing. *(Liang & Elgendi 2018 — odd-reflected-pad is PpgDex's #1 fix; Chebyshev-II 4th-order.)*

### 3C · Signal-quality gating (SQI) — the missing live capability
Detector choice matters less than gating out unusable windows. *Kristof et al. (2024), PLOS Digital Health
3(9):e0000538 — on low-quality single-lead only 3 of 18 detectors reached F1 0.78–0.84; a per-window SQI is
essential.*
- **Window skewness SQI (PPG)** — *Elgendi M (2016), Bioengineering 3(4):21* — the single best discriminator
  (F1 ~86%), one third-moment pass, ~10 lines JS. Clean pleth is positively skewed; motion/flatline collapses it.
- **Template + plausibility (already half-built)** — *Orphanidou et al. (2015), IEEE JBHI 19(3):832* — beat
  template-correlation + HR plausibility (40–180 bpm) + interval consistency as a gate. Vigil already computes
  `corr(w,avg)>0.85` (`analyzePulse ~:1541`) + an implicit HR range — **promote these from the morphology
  panel onto the rate path (`ovRates`)** so a low-quality window shows a dash, not a plausible-but-wrong bpm.
- **ECG live SQI** — a cheap per-window check (QRS-band energy fraction, IBI plausibility) before emitting
  bpm, closing the "plausible HR off electrode noise on a WORN strap" gap the off-body/stall gate misses.
- **Motion term** — fold the ACC/GYRO the Verity streams + the O2Ring motion field into the SQI. Keep it a
  live-view **gate**, never on-box DSP (recorded bytes stay raw).

All SQI terms **extend** the existing `streamState().trust` gate (`monitor.html ~:1204-1210`) — do not
re-build that gate; add a per-window artifact/SQI check to it.

---

## 4 · Robust Bluetooth handling — ranked concrete changes

1. **Bound every post-connect setup await** (`capture.py:762` +7). Closes the "wedge-after-connect → frozen at
   `connected=True`, invisible to every watchdog" hole. **[HIGH]**
2. **Resolve the adapter over D-Bus, not `hcitool`** (`link_rssi.py:72`). Removes the single deprecated
   dependency from the connect/pin critical path; CRITICAL log when unresolved. **[HIGH]**
3. **Untrust after bonding** (`bonding.py:190`) + add `br-connection-canceled` to `_TRANSIENT_BLE`
   (`capture.py:383`). Eliminates the kernel-vs-bleak reconnect race `_CONNECT_LOCK` can't serialize. **[HIGH]**
4. **Per-stream stall watchdog** (`capture.py:907`). Catches the dead-stream-behind-live-sibling class.
5. **O2Ring active scan inside `_CONNECT_LOCK` + prefer passive** (`capture.py:344`). Stops the churniest
   device's 15 s active-scan window from degrading the live H10/Verity links.
6. **GATT service-cache invalidation** (`capture.py:1123`), per-address retry-counted. Breaks the stale-cache
   infinite reconnect loop.
7. **Stronger adapter recovery ladder** (`capture.py:1698`): disconnect → soft power-cycle → `hciconfig
   hciN reset` → USB unbind/rebind. Handles the RTL8761B firmware hang a soft toggle can't clear.
8. **Watchdog give-up → clean non-zero exit** (`capture.py:1687`), gated by `watchdog.exit_on_giveup`, so
   systemd re-execs with a fresh bleak/D-Bus stack instead of looping deaf all night.
9. **Broaden `on_pmd` except + payload-length guard** (`capture.py:661`, `polar_pmd.py decode_frame`).
10. **Fast-path only on `Bonded: yes`** (`bonding.py:150`) + **advert-driven `bond()`** (`bonding.py:191`).
11. **`os.replace()` for `status.json`/`QC-SUMMARY.json`** (`capture.py:1581, 2052`); **classify the
    connection-ceiling error** (`capture.py:307`).

> **Confirmed NOT a live-path issue (do not re-open): MTU=23.** That is bleak's placeholder until a
> characteristic is acquired; the real negotiated ATT MTU (247) is exchanged by the kernel at setup
> regardless. Live runners never read `mtu_size`; the offline PS-FTP path explicitly acquires the real MTU
> (`polar_psftp.py:216`). At most log `getattr(client,'mtu_size',None)` for observability — never gate on it.

---

## 5 · Ideal minimal hardware — recommended BOM + reliability rationale

Consolidates/confirms `CAPTURE-HOST §5`; nothing here overturns it.

- **Compute — Raspberry Pi 5 (8 GB), bedside.** Enough headroom for 3–4 concurrent BLE links + the aiohttp/SSE
  monitor. The reference box today is a desktop `rig-x870`; a real Pi bring-up is still the hard gate on
  `CAPTURE-HOST` DONE.
- **Storage — NVMe HAT + SSD. Never log off microSD** — the single biggest data-integrity lever under the
  continuous overnight write load.
- **Radio — a USB-BLE dongle on a short USB extension AT THE BED. The biggest reliability lever** — body
  attenuation is the dominant loss mechanism (the O2Ring at ~−85 dBm from another room drop-stormed for
  70–79% coverage; no backoff change fixes range). **Disable onboard BT** (avoid the deaf-onboard mis-pin
  class, §2D).
  - *Primary:* **TP-Link UB500 Plus** — RTL8761B, BT 5.3, USB-ID `2357:0604`, plug-and-play, ~3–5 link tier.
    Adequate for the current 4-device config; the money doesn't need to go further here.
  - *Where more money buys reliability (multi-link upgrade):* **Raytac MDBT50Q-CX** — nRF52840, Zephyr
    `hci_usb`, DFU-flashed. You OWN the connection ceiling (tune `CONFIG_BT_MAX_CONN` + ACL buffers) instead
    of hitting the RTL8761B's undiagnosed slot limit, and its firmware-reset story is cleaner for the recovery
    ladder (§4.7). Worth it past ~4 sensors or on ceiling errors.
  - *Avoid:* UB600, CSR8510, no-name Barrot clones (known-bad on Linux/BlueZ).
- **Power — a small UPS/battery HAT** for graceful shutdown → an overnight power blip never corrupts a night.
- **Archive — a second disk for the nightly mirror,** but currently a **removable disk that was unmounted at
  the 2026-07-22 check** (`VIGIL-OFFLOAD-AND-RETENTION`): add `RequiresMountsFor=`/a mount guard so a missing
  backup disk is surfaced, not silent. Preferred production transport: **NAS PULLS from the box** (scheduled
  rsync-over-SSH) so the recorder can't hang on a mount it doesn't own.
- **Config note:** `config.yaml` pins `adapter:` to a MAC that changes on hardware migration — the D-Bus
  resolver (§4.2) makes the pin robust; document the re-pin step for the Pi cutover.

---

## 6 · Similar projects / prior art

**Detector reference implementations to STEAL the algorithm from** (code license noted — suite is Apache-2.0):
- `berndporr/engzee_ecg_detector` + `py-ecg-detectors` — EngZee/Lourenço reference. **GPL → clean-room.**
- `Niaz-Imtiaz/Pan-Tompkins-Plus-Plus` — **MIT**, portable to JS.
- Charlton PPG-beats benchmark + **MSPTD/MSPTDfast** — MATLAB toolbox; reimplement the public method.
- `neurokit2` (lightly-tuned Elgendi/TERMA) — a realistic JS target + speed/accuracy reference (Kristof 2024).

**Upstream issue prior art (already leveraged; cite):** `polar-ble-sdk#287` — root cause of the H10
`already_streaming (0x06)` one-PMD-stream-won't-release behavior that motivates the byte-stall watchdog.

**What to AVOID:**
- 1D-CNN / on-chip AI R-peak detectors — model blob + per-sample convolution, violates the
  lightweight/no-model/no-network constraint (Vijayarangan 2021, arXiv:2101.01666). Park CNN heavy-artifact
  salvage as a *future ECGDex-only research note*, not appliance work.
- Multi-LED/multi-wavelength PPG motion-cancellation fusion — refuted for the Verity (near-identical green
  channels) and impossible for the single-channel O2Ring pleth.
- Trusting device HR summaries — Verity `_HR.txt` all-zero, H10 `_HR.txt` smoothed (CLAUDE.md; research
  confirms, does not overturn).

---

## 7 · What was rejected / already shipped (dead-ends — do not re-propose)

**Rejected on merit:** 1D-CNN live R-peak (ships a model blob for accuracy a gated Elgendi/EngZee already
reaches on simple HR; violates lightweight/no-model/pure-JS). · Classic Pan-Tompkins as the *target to beat*
(among the worst on noisy single-lead — JF 75.3). · Multi-channel/wavelength PPG fusion for the live rate
(refuted for Verity, impossible for O2Ring).

**Already shipped — re-proposing these is the failure mode to avoid** (all verified present):
- **SSE backpressure** — bounded per-subscriber `Queue(maxsize=64)` drop-oldest, subscriber release on
  graceful + abrupt disconnect, both tested (`telemetry.py:163`). *(Optional nicety: a dropped-frame counter
  so the live view can show "lagging.")*
- **Reconnect backoff-on-data** (`capture.py:910`), **adapter InProgress false-wedge guard**, **wear-gate
  removal** (disproven — worn Verity ~1 mg vs desk ~2.3 mg, no separating threshold), **ACC 200→50 Hz cap**
  (`polar_pmd.py:139`) — all v1.17.0.
- **Byte-watching stall watchdog (E1)** — shipped but *collective*; §2C makes it per-stream (a genuine
  extension). **SIGTERM shutdown-sentinel (E2)**, **O2Ring backoff storm fix (E3)** — v1.17.0, validated on the
  2026-07-21→22 overnight.
- **Cross-midnight coverage + night-boundary anchor** (`nightqc.py`) — validated live (H10 34→93–96%).
- **PMD scale/rate correctness** (`PMD-DECODE-SCALE-AND-RATE`, DONE) — proven on real bytes. Do not re-flag
  fs/scale; residual GYRO/MAG/ACC-uncompressed byte-diffs are the open V1/V2 items.
- **O2Ring `.dat` auto-pull backstop**, **retention `keep_nights:14` + nightly mirror**, the night-guardrails
  framework (diskguard/alerts/sdnotify/QC/offload/web-auth), **OxyII protocol + PPG delta decode + H10 bonding
  + `_CONNECT_LOCK`**, **monotonic clock anchor + DST re-anchor + per-night clock provenance** — all shipped.
- **Off-body/charger/stall trust-gate** (`monitor.html ~:1204`) — extend with the SQI (§3C), don't rebuild.
  **IBI-aware systolic cap** (`:1554`) — done; only the FOOT half (§2B) remains. **MTU=23** — placeholder (§4).

---

## 8 · Proposed execution plan (phased, small→large)

Effort: **S** ≤ half-day · **M** 1–2 days · **L** multi-day. Constraints tags: **[local]** no egress ·
**[det]** deterministic browser JS, no deps · **[disk-truth]** live view never the record · **[bounded]**
every BLE await bounded · **[out-of-suite]** no Dex bundle/provenance impact. **This whole brief is
out-of-suite** — no `manifestHash`/`verify-provenance` gate; the regression surface is `capture-host/tests`
(pytest) + a live-box check.

**Phase 0 — safety & correctness one-liners (S, low-risk)** [out-of-suite]
MAC-format validation + `body.get()` at the webmon bond/forget/remember boundary (`webmon.py:118`) · `_save()`
returns status, surface config-write failure as 500 (`:210`) · `_body(req)` guard across POST handlers (`:119`)
· `os.replace()` atomic `status.json`/`QC-SUMMARY.json` (`capture.py:1581, 2052`) · broaden `on_pmd` except +
payload-length guard (`:661`, `polar_pmd.py`) [bounded] · fix the shutdown-sentinel comment (`webmon.py:64`) ·
set `alerts.webhook_url` + `RequiresMountsFor=` archive mount guard (config/systemd, no code).

**Phase 1 — the HIGH BLE correctness holes (M)** [bounded][local]
Bound all post-connect setup awaits, all three runners (`capture.py:762`+7) · D-Bus adapter resolution,
hcitool → last-resort (`link_rssi.py:72`) · untrust after bonding + `br-connection-canceled` in
`_TRANSIENT_BLE` (`bonding.py:190`, `capture.py:383`).

**Phase 2 — BLE robustness deepening (M)** [bounded]
Per-stream stall watchdog (`capture.py:907`) · O2Ring scan inside `_CONNECT_LOCK` + passive (`:344`) · GATT
service-cache invalidation, retry-counted (`:1123`) · recovery ladder hci-reset+USB-rebind, give-up → clean
exit gated by flag (`:1698, :1687`) · auto-pull off-finger settle + no-other-streaming guard (`:2152`) ·
`Bonded: yes` fast-path + advert-driven `bond()` (`bonding.py:150, 191`) · connection-ceiling classification
(`:307`).

**Phase 3 — live detector robustness (M, highest live-view leverage)** [det][disk-truth][local]
5–15 Hz IIR bandpass + robust/adaptive threshold for `detectRs` (`monitor.html:1372`) · same for `detectPulses`
(`:1501`) · gap-aware IBI carrying per-packet `tMs` (`:1153`) · missed/extra-beat 2×/0.5× reconciliation (`:1193`)
· `st.rateAt` staleness stamp + muted `(stale)` render (`:1181`) · promote corr + HR-plausibility onto the rate
path + add skewness SQI, extending the trust-gate (`ovRates`) · detrend + tangent/2nd-derivative PPG foot,
IBI-bounded back-search (`:1531`) · relabel-or-true-accumulate the SpO₂ "session" summary (`:1280, :1620`).

**Phase 4 — MSPTD live pulse + ECGDex detector swap (L)** [det][local]
Reimplement MSPTDfast as the live PPG detector + port PpgDex cadence refractory/sub-harmonic guard · ECGDex
honest-H10 leg: EngZee (clean-room) or Pan-Tompkins++ (port) + parabolic sub-sample interpolation · **gate the
ECGDex switch on a real tri-device-corpus A/B, not MIT-BIH.**

**Phase 5 — sub-sample ensemble alignment (S/M, low priority)** — xcorr fine-align before the averaged-beat
second mean (`monitor.html:1396`).

**Phase 6 — hardware / deployment gates (out of code; block `CAPTURE-HOST` DONE)**
Real Pi 5 bring-up (NVMe SSD, onboard-BT off, dongle bedside on extension, NTP/TZ, `tepna.local`, one clean
22:00→06:00 round-trip with the suite gates green from that origin) · O2Ring range (bedside/second dongle —
the real cure; `.dat` auto-pull is the accepted backstop) · V1–V5 (GYRO/MAG/ACC-uncompressed byte-diffs, OH1
for PPI, a real NTP step, the sudoers apply path) · owner decisions: production box + NAS-pull transport;
`.BPB` exercise-session decoder if the onboard HR backstop is wanted as data · longer-term: gate
`sd_watchdog` capture-liveness on a worn/expected-to-capture signal (needs a wear signal it lacks).

---

## Cross-references
- `VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md` — the field-observation record this analysis executes against
  (E1–E8); several items here are extensions of its shipped fixes (per-stream stall watchdog vs the collective
  E1 one).
- `CAPTURE-HOST-2026-06-29-BRIEF.md` (§4 services, §5 hardware BOM, §11 DONE gate) · `HEALTH-BOX-VISION-2026-07-01-BRIEF.md`
  (§4 the monitor live-view this audits).
- `PMD-DECODE-SCALE-AND-RATE-2026-07-19-BRIEF.md` (DONE — do not re-flag fs/scale) ·
  `VIGIL-WEAR-GATE-AND-ACC-CAP-2026-07-20-BRIEF.md` (wear-gate disproven) ·
  `VIGIL-OFFLOAD-AND-RETENTION-2026-07-20-BRIEF.md` (the archive mount-guard item) ·
  `POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md` (the SDK as authoritative PMD/detector reference).
- `CLAUDE.md` §🎙️ Capture provenance · §🔒 Clock Contract (the gap rule the live IBI defect violates) ·
  §🎫 evidence tiers (any live-derived value stays a live-view estimate, never a graded metric).
