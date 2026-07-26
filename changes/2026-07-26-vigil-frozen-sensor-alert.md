<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
Detect and alert on a sensor that is connected and sending nothing. QC's existing `missing` check means "produced nothing all night" and so cannot see a mid-night freeze — the moment the stream resumes it has rows and stops qualifying — while the offline alert needs the link to actually drop. nightqc now reports `silent_sec` per device (measured against the night's newest write, not wall-clock now), `alerts.frozen_devices` decides on it, and the QC poller warns to the journal and fires a webhook where one is configured. Replayed against the real 2026-07-25 corpus it flags the Verity 128 minutes into its 4 h 25 m freeze.
