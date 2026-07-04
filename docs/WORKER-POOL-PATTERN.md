<!--
  WORKER-POOL-PATTERN.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Parallelizing an analysis tool with a Web-Worker pool — reference for the next paper

How to take a single-threaded Monte-Carlo / cohort analysis tool (the kind each pilot paper
ships) and make it run on a **multicore Web-Worker pool** without freezing the tab — plus the
durability ideas that come with it (live ETA, per-machine rate, single-instance lock, IndexedDB
checkpoint/resume, cancel). The worked example is **`sensor-trio-power-analysis.*`** +
**`sensor-trio-worker.js`** (built June 2026); the original template is
`hrv-confound-analysis.js` + `cohort-worker.js`.

This is an **analysis-tool** change: no app re-bundle, no provenance move (CLAUDE.md). It only
matters when a tool's run is heavy enough that the main thread stalls — a light sim (≤ ~1 min
serial) does **not** need this. Judge by runtime.

---

## 0. When to reach for it
- Serial run is minutes long, or the biggest cell runs many seconds **without yielding** (the tab
  flashes "unresponsive"). `setTimeout(0)` *between* grid points does not help a single hot cell.
- You want the run to survive a preview/tab reload (the agent's own `show_html` / verification
  navigation **kills** an in-page run — this bit us twice on the trio sim).
- Memory is **not** the usual reason: if the tool generates and discards work units one at a time
  (no "materialize the whole cohort" array), the heap stays flat and the bottleneck is CPU time.
  Parallelism fixes time, not memory. (If you DO hold everything in memory, fix that first.)

---

## 1. The core: a dedicated worker + per-trial deterministic seeding

### 1a. Split the file
Move the **pure compute** (RNG, generators, the scoring/estimator kernel, stats helpers) into a
self-contained `Foo-worker.js`. It shares **no scope** with the page, so copy the functions
verbatim (or load shared `*-dsp.js` via `importScripts`, the way `cohort-worker.js` pulls in
`pulsedex-dsp.js`). Keep the kernel **byte-identical** to the main module so serial and parallel
agree — the trio worker copies `genWindow` + `tchSigmas` + the RNG exactly.

### 1b. Seed PER WORK-UNIT, not per run (the key trick)
A shared RNG stream seeded once per run makes results depend on draw order → sharding across N
workers changes the numbers. Instead, derive each unit's seed from its **coordinates** so a unit's
draws depend only on *what it is*, never on *who ran it or when*:

```js
// identical copy in BOTH the worker and the main module
function trialSeed(stream, N, t) {            // stream = regime/leg id, N = cell, t = trial index
  let h = (Math.imul(stream+1,0x9E3779B1) ^ Math.imul(N+1,0x85EBCA77) ^ Math.imul(t+1,0xC2B2AE3D)) >>> 0;
  h = Math.imul(h ^ (h>>>15), 0x2C1B3C6D); h ^= h>>>13; h = Math.imul(h, 0x297A2D39); h ^= h>>>15;
  return h >>> 0;
}
// at the top of each trial:  seed(trialSeed(streamId, N, t));  then draw.
```

Payoff: the sweep is **bit-reproducible and pool-size-independent** — 1 worker or 8, split into
any block sizes, the aggregated result is identical (verified on the trio sim: two runs returned
the same value to full float precision). It also means a re-run reproduces a committed `stats.json`
exactly, the property the provenance story wants. **Convert the serial path to the same seeding**
so serial (the fallback) and parallel produce the same numbers.

### 1c. Aggregate order-invariantly
Workers return per-unit results that the main thread concatenates; final stats (median, percentile
CI, sums, counts) must not depend on arrival order. Sort before median/percentile; sum counts.
Then blocks can complete in any order across the pool.

---

## 2. The job protocol (mirror cohort-worker.js)

```
main → worker  {type:'init'}                         worker → main {type:'ready'}
main → worker  {type:'job', reqId, kind, …params}    worker → main {type:'done', reqId, …payload}
```

- **`reqId`** routes the reply through a shared `pend = Map<reqId, resolve>` — `runJob` returns a
  Promise that resolves when the matching `done` arrives.
- Shard the heaviest axis into **blocks** (the trio uses 256 trials/job) so load balances and
  progress is smooth. Carry a stable **`key`** per block (`'c|'+regime+'|'+N+'|'+t0`) for the
  checkpoint's done-set.
- Send per-job config that can drift (window length, ar1, ρ) in the message; keep planted constants
  in the worker.

---

## 3. Pool boot + dispatch (the lane pattern)

```js
const K = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
function bootPool(K){ /* K× new Worker(); resolve a readies[] on each {type:'ready'};
                        Promise.race([Promise.all(readies), 8s timeout]) */ }
function runJob(rec, job){ /* reqId++, pend.set, postMessage, 5-min watchdog → {error:'timeout'} */ }

let qi = 0;                                   // shared queue cursor
async function lane(rec){                      // one lane per worker; they share the queue
  while (!CANCEL){
    const j = jobs[qi++]; if (!j) return;
    const r = await runJob(rec, j);
    if (r.error){ jobs.push(j); continue; }    // requeue a timed-out block once
    /* fold r into accumulators; mark done[j.key]; update ETA; throttled checkpoint */
  }
}
await Promise.all(rdy.map(lane));              // wall-clock ≈ serial / cores
```

**Always keep a serial fallback**: if `rdy.length === 0` (Workers blocked), run the old in-page
sweep so the tool still works. The trio `run()` branches to `sweepRegime`/`sweepRho` in that case.

---

## 4. The "other ideas" worth lifting (all from hrv-confound)

| Idea | What it buys | Keys / notes |
|---|---|---|
| **Live ETA** | trust during a long run | `fmtETA`; status `"NN% · K× · rate · ETA"`, weight work by `count×N` |
| **Per-machine rate** | pre-run estimate on the N input | persist `secPer500` (or `pt/s`) in `localStorage`; `updEta()` echoes near the input |
| **Single-instance lock** | agent preview + user tab don't double-run | `localStorage` heartbeat (`{id,ts}`, 6 s stale), beat every 2 s, release at end |
| **IndexedDB checkpoint/resume** | survive a preview reload | save `{sig, acc, done, savedAt}` every ~1/30 of the run; auto-resume if `<20 min` old AND `sig` matches; honor the lock; **clear on clean finish** so only interrupted runs resume |
| **Cancel** | stop a wrong run without a tab kill | a `CANCEL` flag the lanes check; on cancel, save a checkpoint so re-run continues |

`sig = trials|winSec|ar1|grid` — only resume a checkpoint whose `sig` equals the current config,
else the shapes won't line up.

---

## 5. Gotcha: capturing canvas figures
`html-to-image` (the `screenshot` / `multi_screenshot` path) **cannot reliably capture `<canvas>`**
— it renders a gray placeholder. That is exactly how the trio's `fig2` shipped broken. Use the
**native** `save_screenshot` (hq) over a full-bleed render instead. The trio tool exposes
`window.__figShow(which, W, H)` (draws one figure to a fixed-position overlay canvas) and
`__figDataURL` for headless export; drive `__figShow` then `save_screenshot` to the figure path.

---

## 6. Checklist for the next tool
1. `Foo-worker.js`: RNG + generator + kernel + stats, byte-identical to the page; `trialSeed`
   copied verbatim; `init`/`job` handlers.
2. Page: convert the trial loop to `seed(trialSeed(...))`; add pool (`bootPool`/`runJob`/`lane`),
   `CANCEL`, lock, IDB checkpoint, ETA + rate persist, cancel button + `#eta` echo, serial
   fallback. `K = min(8, hardwareConcurrency||4)`.
3. Verify: run twice → identical numbers (determinism); confirm `rdy.length>0` and the speedup;
   serial fallback still matches.
4. Figures via native `save_screenshot`, not html-to-image.
5. It's an analysis tool → **no re-bundle, no provenance**. Regenerate the paper's `stats.json` +
   figures from the new run and update cited numbers if the seeding/trial-count changed.

> Reference implementations: `sensor-trio-worker.js` + `sensor-trio-power-analysis.js` (this pass),
> `cohort-worker.js` + `hrv-confound-analysis.js` (original). Worker count, lock, checkpoint and ETA
> all follow the latter.
