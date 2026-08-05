<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
---

The CPAP poller's Wi-Fi association was made and never observed: its test double accepted all eight
arguments and recorded two. `tools/find_blindspots.py` ranked `timeout` as the most-discarded argument
name in the suite (68 doubles) and led here; mutation then confirmed that swapping the SSID and PSK for
"wrong-ssid"/"wrong-psk", and cutting the association timeout from 45 s to 1 ms, both survive the whole
cpap suite. The double now records the whole call and three assertions pin the credentials, the card
address and the timeout. The lifeline-guard mutants were already killed and still are.
