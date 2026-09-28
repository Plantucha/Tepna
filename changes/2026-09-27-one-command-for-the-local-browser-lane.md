---
bump: minor
type: added
brief: none
---

**`npm run gates:browser:local`** — one command for the browser lane, and `--label` to prove a named
assertion actually executed.

The lane was always runnable and never in one step: `tests/browser-gates.mjs` needs an http origin (the
suite is same-origin; `file://` will not do) and takes it from `BASE_URL`, so every session hand-rolled
"start a server, pick a port, export `BASE_URL`, remember to kill the server". **Measured cost on
2026-09-27 alone: two re-runs in one session**, one from a scratch script still pointing at `node_modules`
inside a worktree reclaimed hours earlier — it raised `ERR_MODULE_NOT_FOUND` where a verdict should have
been, and beside a green JS gate that reads as a lane that ran. The failure mode is not the browser; it is
that the invocation lived in scratch files with absolute paths, so it went stale silently. An entry point in
the repo cannot.

**`--label <text>` (repeatable) fails the lane when that assertion name appears nowhere in the run.** That
is the "did my assertions actually execute" question sessions kept re-deriving by reopening the page in a
scratch script — a green summary does not distinguish *passed* from *never executed*, and this lane's own
history is why (#816: 5316 passed / 1 failing against 5494/5494 in node, because a source-scan gate's file
was wired into only one lane). It lives in `browser-gates.mjs`, which already has the page open, rather than
in the wrapper, which would have to re-open it and double a ~15-minute run. The labels are tested **inside**
the page against `div.test .name`, so only booleans cross the boundary — a run carries ~9.7 k assertion
names.

Three things the entry point refuses to get wrong:

- **The server is in-process** — `listen(0)`, then it asks the OS which port it got. Nothing to kill, so
  nothing to leak: no child `http.server`, no PID hunt, and no `pkill -f` (which matches its own command
  line — §👥.4, exit 144). Two sessions can run it at once.
- **The exit code is the lane's**, never a pipe's (§4b). A signal death becomes 1, never 0.
- **Chrome resolution is not re-derived.** `browser-gates.mjs` already delegates to `tools/pw-launch.mjs`'s
  `launch`, which falls back from a missing bundled Chromium to `systemChrome` and honours `TEPNA_CHROME`.
  A new script copying `executablePath` would have duplicated working logic.

**Deliberately NOT part of `npm run check`:** the lane needs a browser, and `check` must stay runnable on a
box without one. CI runs the browser lane as its own job.

Demonstrated end-to-end on a fresh worktree with only the `node_modules` symlink — no absolute path
anywhere: `serving … at http://127.0.0.1:40787`, suite `9731 passed · 98 skipped`, `✓ label ran: …` for a
real label, and **EXIT=1 from a bogus `--label` alone** while the suite itself was green. `--selftest`
carries 13 assertions, most of them the traversal refusals — serving a whole checkout means `..` must not
walk out of it, including the encoded `%2e%2e` form, a NUL byte, and a sibling directory that merely shares
the root's prefix. A local dev server that trusts its URL is a file-read primitive.
