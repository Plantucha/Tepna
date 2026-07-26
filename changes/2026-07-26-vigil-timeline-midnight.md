<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The capture timeline showed only the post-midnight half of a night. Capture folders roll by session START date, so a night beginning at 22:26 leaves its first hours in the previous day's folder — nightqc has pooled the two halves since it was written, but the timeline read one directory, so every device's strip appeared to begin in the middle of the night and the missing hours rendered `idle`, the colour reserved for "nothing was recording". build() now pools the previous day on nightqc's own near-midnight gate, and the LINK reader accepts several directories so a device's identity mapping learned in one half reaches the other.
