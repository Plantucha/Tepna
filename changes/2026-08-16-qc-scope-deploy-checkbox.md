---
bump: patch
type: fixed
---

**An unticked box in a DONE brief was read as "not done" three weeks later, and nearly caused a rebuild.**

`QC-SCOPE-RESOLUTION-2026-07-28` §6 ended with `- [ ] Deploy to the box — /opt/tepna/capture-host still
runs the pre-fix code`. On 2026-08-16 that line was **stale**: the box carries `newest_data_mtime`,
`scope_suspect`, `judged_dir` and `searched_dirs`, alongside work that merged the same day. The box
self-updates hourly; the line outlived the deploy it described.

It cost real time. Investigating whether QC should become night-scoped, that checkbox read as an open
deployment gap on a brief whose header already said `DONE`, and the four layers it describes had to be
verified against the box directly before the brief could be trusted. The **header is authoritative** —
this is the documented convention, and the box counts are now written beside the tick so the next reader
does not have to re-derive them.

Same species as the 76 unchecked boxes sitting in other DONE briefs: **rank a brief by its header prose,
never by its box counts.**
