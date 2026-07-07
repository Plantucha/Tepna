<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: DEV-TOOLCHAIN-2026-06-30-BRIEF.md
---
Add the root `package.json` dev-tooling spine — a private, unpublished manifest (no runtime deps, ships nothing) that unifies `tools/build.mjs`, the pinned `tsc`/ESLint tools, and the gate runners under one `npm run` surface (`check`/`test`/`typecheck`/`lint`/`build*`/`verify:manifest`/`gen:lists`/`release`); the four CI workflows now route through those scripts so each command has a single source, and browser-gates no longer `npm init -y` over the committed manifest.
