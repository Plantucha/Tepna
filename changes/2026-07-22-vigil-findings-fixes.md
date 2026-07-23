<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md
---
Execute the strictly-safer Vigil findings (out-of-suite capture-host/): bound every post-connect GATT
setup await (start_notify + O2Ring auth/setup/RTC writes) in all three BLE runners so a BlueZ wedge
landing after connect() raises and retries instead of freezing a device at `connected=True` all night;
broaden the PMD notification handler past ValueError and guard `_decode_delta` against a truncated frame
so a short frame never IndexErrors into the bleak callback; validate the device MAC at the webmon
bond/forget/remember boundary (a newline could inject bluetoothctl control commands) and guard malformed
JSON bodies as 400 not 500; make `_save()` report a failed config write as 500 instead of a silent
`ok:true`; write status.json + QC-SUMMARY.json atomically via os.replace; and classify
`br-connection-canceled` as transient. 9 new capture-host pytest cases; 911 passing.
