---
bump: patch
type: fixed
---

Two more links of the same chain, and five fields that reached nobody's eyes.

`find_unwired.py` scan 1 treats `webmon.py` as a consumer, so **forwarding a status key satisfies it while
the key still reaches no one**. That left five fields published to `/api/state` and drawn by nothing:
`rate_unmet`, `last_sample`, `worn_why`, `worn_optical`, `worn_optical_why`. `worn_why` makes the argument
against itself — its own comment in the projection reads *"The daemon logs the conflict; a log line does
not reach the person looking at the monitor"* — which is exactly as true one layer further along.

**Scan 3** (forwarded but never drawn) and **scan 4** (a handler with no control) close it, and all five
fields are now rendered:

| field | how it surfaces |
|---|---|
| `worn_*` (three fields) | a `contact?` chip that appears **only when the two detectors disagree**, naming both verdicts — shown, not re-arbitrated, per #1228 |
| `rate_unmet` | a chip reading `ppg 55/176 Hz`; the config still claims the rate that was asked for, so nothing else says a Verity was negotiated down |
| `last_sample` | an **absolute** wall-clock time on the device row — deliberately not "4m ago": the stamp is the box's naive local civil time, and differencing it against the viewing browser's clock would make the number depend on where the monitor is read from |

**Scan 4 found `syncAllTime` on its first run** — a complete host-plus-every-device clock sync, POSTing an
endpoint registered since `dace8cba` ("the PAT precondition"), with no button anywhere in the page. The one
control that puts the box and every sensor on a single timebase in one press had been unreachable since it
shipped. It now sits beside Scan.

**⚠️ The tool committed its own defect class for a fourth time, and only a reversal test found it.** Scan 3
greps `monitor.html` for the key — and a reference inside a helper nothing calls is not a rendering.
Deleting `${lastSampleText(d)}` from the device row left scan 3 **perfectly green** while the field reached
nobody, because the key still appeared inside the helper's own body. That is scan 2's `uses - defs` rule
(*the definition is not a use*) needing to apply to the page as well, which is what scan 4 does.

**Scan 3 also failed open, which is the same class again.** If the AST anchor stops matching, `projected_keys`
returns an empty set and the scan reports `0 unexplained` **forever** — a check that examines nothing and
calls it clean. Losing the anchor now reds instead, and a test pins it.

Four mutants verified dead (each scan disabled; the fail-closed branch removed; scan 4 counting a definition
as a use). An earlier mutation run reported `22 passed` four times over because the mutants never applied —
a quoting error made every run a false green, which is the failure class being fixed here, arriving in the
middle of fixing it.
