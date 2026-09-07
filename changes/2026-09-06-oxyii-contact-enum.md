<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
**A faulted O2Ring probe was being recorded as a worn finger, and an unplugged one was being read as
evidence of encryption.** RtParam byte `[5]` is a four-state enum — per vendor SDK sources (OxyII
family): `0` lead-off · `1` normal · `2` probe unplugged · `3` sensor/probe fault. Tepna read it as
`(0, 1, 3)` labelled "no finger, idle-present, file open", which was wrong in both directions: `3`
counted as **worn**, and `2` fell outside the enum and so fed `frame_looks_like_ciphertext` as
suspicion. Now all four are in-enum and only `1` is worn.

**Latent, not a repair.** The corpus carries only `0` and `1` across 150.8M rows, so no recorded night
changes and nothing needs refolding — this is the first night with the right labels rather than a fix
to past data.

**RT_PARAM byte `[14]` is now recorded as `alarm_raw`**, a new trailing `OXYFRAME` column: four 2-bit
subfields (`&3` invalid-IV state, `>>2` SpO₂ alarm, `>>4` HR alarm, `>>6` motion alarm), stored RAW and
uninterpreted, exactly as `flag_raw` is. A frame too short to carry the byte writes **blank, never 0** —
a zero there would read as "all alarms clear" on evidence that does not exist.

⚠️ Appending that column moved every column the writer tests were reading by NEGATIVE INDEX
(`cells[-3]`, `[-2]`, `[-1]`); one of them asserted `flag_raw == "0"` and got `199`. They now index by
header name, which is the addressing scheme this format publishes — the tail never had a contract.

Also recorded as legend comments, so no reader re-derives them: `run_status` 0 prep · 1 measure-prep ·
2 measuring · 3 ended; `batt_state` 0 normal · 1 charging · 2 full · 3 low (<10 %); `ppg2w` channel 0 =
IR, channel 1 = RED.
