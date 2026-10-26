# Verity Sense SDK mode — one-night trial runbook

Prepared by Heron for the owner, 2026-10-21, under the owner ruling of that day (board #903 item 2).
The owner deploys. No bird deploys to the capture box, and this runbook restarts nothing by itself.

Rule 0: `Verity Sense SDK mode capture config.yaml one-night trial` →
`briefs/VERITY-OFFLINE-VS-STREAMING-2026-08-09-BRIEF.md:206-222`,
`capture-host/config.example.yaml:85-110`, `capture-host/polar_pmd.py:275-296`,
`capture-host/tests/test_sdk_mode.py`, `briefs/RESIDUE.md:332`.

## What the trial changes

Two values in the Verity device block of `/opt/tepna/capture-host/config.yaml`:

| key | from | to |
|---|---|---|
| `sdk_mode` | absent | `true` |
| `rates.ppg` | `55` | `176` |

The "from" column is the state the ledger recorded on 2026-09-22. The script reads the live file and
prints what it actually finds, so a different pre-state shows up before the script writes anything.

## Why both keys, and why neither alone works

Without SDK mode the Verity offers PPG at 55 Hz only. `polar_pmd.chosen_rate` honours a configured
rate only when the device offers it, and otherwise falls back by design. So `ppg: 176` alone produces
55 Hz, no error and no log line naming the refusal. That is the whole failure mode this
runbook guards against.

SDK mode alone changes nothing either. It only widens the device's menu to 28 / 44 / 55 / 135 / 176 Hz.

## The script

The box carries the whole repository at `/opt/tepna`, so a fast-forward pull on `main` brings both
halves of the script with it. The CLI is `capture-host/tools/verity_sdk_trial.py` and the decisions it
runs on are `capture-host/verity_sdk_config.py`, beside it one directory up. Three verbs, stdlib plus
PyYAML:

```
cd /opt/tepna/capture-host
.venv/bin/python tools/verity_sdk_trial.py check     # read-only, prints the diff
.venv/bin/python tools/verity_sdk_trial.py apply     # writes, then proves the write
.venv/bin/python tools/verity_sdk_trial.py revert    # restores the newest backup
```

The split is the repository's rule for `capture-host`, not a preference. `tools/` sits outside the
coverage floor, so the CLI holds argparse, the read, the write and the backup, and every decision that
could be WRONG lives in the module the floor measures. `tests/test_verity_sdk_config.py` covers that
module to 100 % of its statements and branches, negative controls included.

It edits the file as TEXT and never round-trips the YAML, because `config.yaml` carries measured
findings in its comments and a PyYAML dump drops every one of them. It then parses both versions and
proves that only those two keys moved. A third value moving refuses the write.

It refuses a config with no Verity block, and a config with two. It redacts every MAC from its own
output. It names its backup `config.yaml.verity-sdk-trial.bak-<UTC stamp>`, which the monitor's own
`config.yaml.bak` can never overwrite.

**Measured 2026-10-26 on a synthetic config** that holds an H10, a Verity at 55 Hz with `ppi` and
`hr` in its streams, a `storage` block, and a trailing comment on the `ppg` line. The `apply` verb
moved exactly `sdk_mode` and `rates.ppg`. It left the H10 and `storage` byte-identical, and it kept
every comment, including the one on the line it rewrote. A second `apply` wrote nothing and said so.
The `revert` verb restored the file byte-identical to the original. Four refusals exit 1 and each
names its reason: an absent config, a config with no Verity block, a config with two, and a `revert`
with no backup to read.

That hand-run also found a defect in the first draft. The script read
`ppg: 55   # the device offers 55 only without SDK mode` as the whole value, comment and all, and it
dropped that comment when it rewrote the line. The free-space line read `unreadable` for the same
reason, because the capture root carries a comment too. `value_of` now reads past an inline comment,
`comment_of` carries the comment forward, and two tests hold both halves.

## The deploy, in order

1. Bring the box's checkout to `main`: `git -C /opt/tepna pull --ff-only`. Then
   `cd /opt/tepna/capture-host` and run the `check` verb. Read the diff and the warnings.
2. Charge the armband to full. At 176 Hz it measured 8.60 %/h against 4.74, which is ~11.6 h of
   runtime instead of 21.1. That is one night per charge instead of two.
3. Run `apply`. It prints the backup path. Keep that path.
4. Restart the daemon: `sudo /usr/local/lib/tepna/tepna-restart.sh restart`. The device fixes the rate at PMD
   START, so only a reconnect changes it.
5. Confirm the device actually entered the mode (next section). Do not trust the config for this.
6. Sleep the night.
7. Run `revert`, then restart again. One night is the approved scope.

## Confirming the mode, not the intention

SDK mode does not survive a power cycle, and the device is the only authority on whether it is on. The
daemon knows this: it asks the device after its own ACK and publishes the answer as a tri-state.

- `curl -s http://127.0.0.1:8760/api/state` → the Verity's `sdk_mode` is what the config asked for, and
  `sdk_mode_actual` is what the device answered. **Null is not false.** Null means the device never
  said, so it confirms nothing.
- `journalctl -u tepna-capture.service -g 'options:'` → the device's own menu, logged at connect. A
  line reading `rate_hz=[55]` for PPG means the mode is off and the night will run at 55 Hz.
- After the night, read the rate off the written stream rather than off the config.

## What the trial costs

- **PPI and HR go silently absent.** SDK mode disables both on a Verity. This costs nothing the fleet
  uses: the onboard `_HR.txt` is all-zero and `_PPI.txt` is often header-only, so honest Verity HR
  already comes from the raw PPG.
- **PPG volume rises by 3.2×** at the same wall-clock duration. The script prints the free space on the
  capture root before it writes.
- **Battery, as above.** A flat armband mid-night ends the capture.

## What the evidence says about 176 Hz

The rate question rests on decimating ONE night, which holds subject and physiology fixed
(`PPG-SAMPLE-RATE-AND-PAT`). rMSSD, per-epoch HR error and PAT residIQR all read FLAT from 44 Hz up —
37.8 ms and 18.6 ms at both 44 and 176. On the evidence alone the recommendation is 44-55 Hz.

So 176 Hz is an operational call rather than a technical result, and the trial asks a different
question: what the hardware does for a whole real night at its top rate. The residue row
`2026-09-22-cvhr-cross-node-correlation-is-corpus-dependent` is the candidate this feeds.

## What not to do during the trial

Do not save anything from the monitor's Settings card while the trial runs. A settings save writes the
whole config, and on 2026-08-03 one such save lost a 176 Hz PPG rate with nothing logged and nothing
failing. The monitor preserves rates it cannot show today, but the trial's own backup is the thing to
rely on.

Fleet-Session: Heron
