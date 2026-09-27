<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tools, tests]
brief: none
---
`tools/pw-launch.mjs`: when Playwright's bundled Chromium is not downloaded (`Executable doesn't exist`), relaunch
once on the first system Chrome found (or `$TEPNA_CHROME`), saying so on stderr — the browser test lane is
runnable on a dev box without a network download. Sandbox handling unchanged; a missing browser with no system
Chrome is rethrown. Self-tests 10 → 19.
