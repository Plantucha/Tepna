<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md
---
Widen `dex-ingest.js` `deviceKey`/`stampMs` to accept the capture-host's contiguous `…_YYYYMMDDHHMMSS_KIND` stamp alongside Polar Sensor Logger's `…_YYYYMMDD_HHMMSS_KIND`. Only the latter parsed, so `deviceKey` returned null on **every** Vigil-captured file, `hasDev` went false, `anchor` went null, and `planIngest`'s entire device-eligibility block was skipped — a Verity ACC became a legal companion for an H10 ECG. Fixed app-side on purpose: the parsers must keep reading the genuine PSL corpus either way, so widen rather than switch, and the on-disk filename is unchanged (renaming would orphan ~478 recorded nights). Also corrects `writers.py`'s false "matches Polar Sensor Logger" comment and the `test_writers.py` test whose name asserted the same non-existent parity.
