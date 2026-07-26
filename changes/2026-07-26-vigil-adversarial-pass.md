<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Adversarial pass over the newest capture-host surfaces: seven confirmed defects fixed. timeline.py matched device_id as a bare substring (one sensor could claim another's files), summed overlapping sessions into >100% coverage, reported an end-of-night sensor removal as an adapter wedge, and folded a pre-window link sample into bucket zero. storage_targets.py accepted paths and share names with no charset check, so a newline injected directives into the generated systemd unit and a `;` reached an unquoted `sudo tee` step the operator is told to paste as root; the credentials path could append a cifs mount option. polar_pmd was fuzzed with 30k malformed frames and held.
