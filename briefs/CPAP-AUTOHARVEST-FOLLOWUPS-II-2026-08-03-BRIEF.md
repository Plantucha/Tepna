<!--
  CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-03 · **Follows:** `CPAP-AUTOHARVEST-FOLLOWUPS-2026-07-28-BRIEF.md` (DONE — 2026-08-03)

# What the guarantee sweep left behind — two owner-owed deploy items, one probe, and a method worth reusing

The parent is DONE: §1.2's directive was executed (124 guarantee-bearing docstrings swept, the two real
gaps gated and verified RED), §2.1 routed, §2.2 injected and fixed, §4 and §5.1 closed. This is the
residue — none of it blocks what shipped, and two of the four items are not code at all.

---

## 1 · The alert transport is still OFF on the box (owner)

Carried verbatim from the parent §2.2, because it is the one item where the repo is green and the
**field is not**. Two independent reasons no failure can page anyone today:

1. The deployed `/opt/tepna/capture-host/config.yaml` has **no `alerts:` block**, so
   `Notifier(None, enabled=False)` is constructed and `send()` returns `False` without posting.
   `if notifier:` is still truthy — the object exists — so every call site runs and silently no-ops.
2. The raising-harvest alert fix is **committed, not shipped**. The box still runs the old `capture.py`.

**Owner actions, in order:** configure `alerts:` (`enabled` + `webhook_url` — the endpoint is a
decision and the URL is a secret no session holds), then deploy. Deploying is a deliberate **two-step**:
`git pull` **and** `sync-apps.sh` — the first alone is half a deploy.

**Done when:** a deliberately induced failure on the box delivers a real webhook. The parent's TEST-NET-1
injection (`192.0.2.1`, zero blast radius, no config touched, destination verified empty afterwards) is
the harness to re-use — it is the only fault injection in this family that has ever found something.

## 2 · `probe_pmd_surface._read_char` is the one guarantee left unchecked

The third function whose guarantee no test names. Deliberately skipped rather than missed:

- it is a one-shot BLE developer probe, not daemon code, and reaching it needs real hardware;
- it sits inside the scope of an in-flight worktree (`POLAR-PMD-COMMAND-SURFACE-2026-08-02`).

Its promise — *"a missing characteristic must not abort a sweep that has 40 other things to collect"* —
is exactly the fail-open shape worth gating, and it is cheap to gate with a fake client (no hardware:
`read_gatt_char` raising, and returning undecodable bytes). **Whoever lands the PMD work should take it**;
splitting it out now would collide for no gain.

## 3 · The sweep method, and the check that must NOT be reused

Worth keeping because the first answer was wrong in a way that would recur.

**Reusable:** enumerating guarantees by AST over docstrings matching *never · always · must · cannot ·
guarantees · refuses · is an ALERT · not a silent · invariant*. Cheap, complete, and it turns "grep the
daemon" from a vague instruction into 124 named sites.

**Not reusable:** cross-referencing those names against the test tree. It reported the daemon
**121/124 clean** and was blind to both real gaps, because *named in a test* and *gated by a test* are
different properties — and in the opposite direction it would have condemned five guarantees that are
gated perfectly well transitively, through `_mirror_matches` / `summarize` / `timeline.build`. Only
deleting the promise and re-running answers the question.

**Open:** the sweep covered `capture-host/*.py`. The same enumeration has never been run over the
**JS spine** (`clock.js`, `*-dsp.js`, `integrator-dsp.js`), where the docstring-as-guarantee habit is at
least as strong and where `tools/mutate.mjs` already exists to do the killing. `clock.js` is at 73 %
(`CLOCK-AXIS-AND-RENDER-SURFACE-FOLLOWUPS`), so the surviving mutants there are already enumerated —
the new question is which of them sit under a *documented promise*, which is a sharper prioritiser than
raw survival count.

## 4 · Backfill throughput is still measured once, on one card

Unchanged from the parent §2.3 and still not worth doing on its own: `130 KB/s` and `1.65 MB/s` are the
same card on different days by different methods. Neither is wrong; they are not comparable. Re-measure
if backfill time ever matters again rather than trusting either — and note the brief quoting 65 min for
a full backfill is using the slower one.

---

## 5 · Done when

- [ ] §1 — `alerts:` configured on the box **and** deployed (`git pull` + `sync-apps.sh`), proven by an
      induced failure delivering a real webhook
- [ ] §2 — `_read_char`'s absence-is-absence promise gated with a fake client, by the PMD work-unit
- [ ] §3 — the guarantee-docstring sweep run over the JS spine, prioritising `tools/mutate.mjs`
      survivors that sit under a documented promise
- [ ] §4 — nothing, unless backfill time matters again
