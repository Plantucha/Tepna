<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living findings record) · **last-verified:** 2026-07-12 · **Charter:** `audits/EFFICIENCY-AUDIT-PROMPT.md` · **Sibling-of:** `audits/EFFICIENCY-AUDIT-FINDINGS-2026-07-01.md`

# Efficiency audit — findings, 2026-07-12

Run of `audits/EFFICIENCY-AUDIT-PROMPT.md` against `main` @ `7819605`, on a green baseline
(2107 assertions · GATE A 8/8 · GATE B 23/23 · no build drift). Machine: AMD Ryzen 9 9900X, node
v22.23.1. Every number below is measured on **real committed inputs at real scale**; hypotheses are
labelled as such.

> **The two headline results are not speedups.** The audit found a **user-facing wrong number** and a
> **gate that is weaker in CI than it looks**. Per `AUDIT-PROMPT.md`, correctness outranks efficiency —
> so they lead.

---

## 🔴 C1 · CORRECTNESS · **HIGH** — the PpgDex perfusion-index trend is mostly `null`, and has been all along

`ppgdex-morph.js:140` steps a sample loop by a **non-integer** stride:

```js
const winSamp = winSec * fs;              // 60 × 176.26 = 10575.6  ← fs is a float, always
for (let w0 = 0; w0 < tEndSamp; w0 += winSamp) {
  const s0 = w0, s1 = Math.min(raw.length, w0 + winSamp);
  for (let i = s0; i < s1; i++) { acc += Math.abs(raw[i]); … }   // raw[10575.6] → undefined
```

`fs` comes from the median sensor-ns delta, so on a real Polar capture it is **never** an integer.
From the second window onward `i` is fractional, `raw[i]` / `bp[i]` return `undefined`, `dc`/`ac`
go `NaN`, and **`pi` is silently `null`**. The surfaced per-window perfusion-index trend chart
(`ppgdex-app.js:290`) is plotting a fraction of its points — the rest are dropped, with no warning.

**Measured** (independently reproduced twice):

| capture | windows | windows with a PI |
|---|---|---|
| `ppg-nights/n0611a.txt` (fs 176.26) | 2 | **1** |
| `ppg-nights/n0612b.txt` (190,535 samples/ch, 1157 beats) | 18 | **2** |

Only the windows where `w0` happens to land on an integer survive. Fixing it also removes V8's
megamorphic slow path on ~3n element reads: `PPGDSP.analyze` **173.8 → 77.5 ms (2.24×)**, and the
`pi` series goes from `2.62 · · · · 0.8 · · …` to a complete `2.62 0.95 0.92 0.86 0.79 …`.

**The change:** `const s0 = Math.round(w0), s1 = Math.min(raw.length, Math.round(w0 + winSamp));`
— the tightest possible fix; it leaves the beat→window assignment untouched, so **only `pi` moves**.

**Gate impact:** `ppgdex-morph.js` is inlined by `PpgDex.src.html` **only** → rebuild `PpgDex.html`
alone. The node-export hash was verified **unchanged** on the real equiv input, the synthetic golden,
and `n0612b`, so **both code-gated PpgDex fixtures stay byte-identical** and the equiv leg stays green.
It *does* move a surfaced number (`morph.perWindow[].pi`) — that is the point, and those app summary
JSONs are not in `FIXTURE-PROVENANCE.json`. **This is a correctness fix that happens to be faster.**

---

## 🔴 G1 · GATE INTEGRITY · **HIGH** — CI runs a weaker gate than local, and the skip count is unpinned

The real recordings live in a **gitignored `uploads/`**. CI is a fresh clone, so the fixtures whose
inputs are real captures degrade to `⊘ SKIP` — and a skip is *neither pass nor fail*, so the gate
goes green having never run them.

| | local (real corpus) | **real CI** (run `29198819932`) |
|---|---|---|
| assertions | 2107 · **2 skipped** | **2087 · 11 skipped** |
| GATE B fixtures | **23 reproducible** | **10 reproducible · 13 skipped — "uploads/ not served"** |

So **13 of 23 provenance fixtures are never verified on the merge path**, and the real-recording
equivalence legs (OxyDex/PulseDex/HRVDex/GlucoDex/PpgDex/ECGDex) do not run there. Worse:
`grep -rn "skipBudget\|expectedSkips\|MAX_SKIP" tests/` → **0 hits**. Nothing pins the expected skip
set, so **a new skip is invisible** — rename an input and its equiv leg silently becomes a ⊘ while the
suite stays green.

This also collides with `CLAUDE.md` §👥, which *mandates a worktree* for DSP/bundle/ledger work: a
worktree checks out **tracked files only**, so the mandated workflow runs the weaker gate too.

**The change:** (a) a **skip-budget assertion** — the runner declares the expected skip set per
environment (full corpus ⇒ ≤2; tracked-only ⇒ exactly the 11 named legs), so a *new* skip reds;
(b) honour `DEX_UPLOADS=<path>` so a worktree/CI can point at a real corpus and get the full gate.
**Gate impact:** runner + `dex-tests.js` only. No re-bundle.

---

## 🟠 M1 · METHOD · **HIGH** — the Node `vm` realm distorts profiles up to 12×, and it already produced one wrong brief

`tests/run-tests.mjs` loads the DSPs into a contextified `vm` sandbox. Global lookups (`Math`, `Date`)
there go through the context's interceptors, so **tight numeric loops inflate wildly and
non-uniformly — which re-ranks the profile.** Same code, same input:

| | vm realm | main realm (≈ browser) | distortion |
|---|---|---|---|
| `PulseDex.compute` (534 RR) | 106.6 ms | **8.7 ms** | **12.3×** |
| `OxyDex.compute` (26,157-row night) | 481.8 ms | **146.1 ms** | 3.3× |
| `PpgDex.compute` (n0612b) | 1068 ms | **411 ms** | 2.6× |

**This is not academic — it invalidates a shipped brief.**
`PROFILED-HOTSPOTS-CI-AND-DSP-2026-07-12-BRIEF` **§3** claims *"`PpgDex.compute()` spends 28% in
`mean`, because `pearson()` recomputes `mean(tmpl)` per beat — hoisting is bit-identical by
construction."* **It does not reproduce.** The hoist was implemented exactly as specified and A/B'd
end-to-end on real captures:

| input | base | hoisted |
|---|---|---|
| `n0612b` (1157 beats) | 347.4 ms | **342.3 ms (1.015×)** |
| the committed equiv clip | 113.0 ms | **113.6 ms (1.00×)** |

True self-time in a browser-representative realm: **`mean` = 0.84%**, `pearson` = **0.00%**. It could
never have been 28% — 1157 beats × a 114-sample template ≈ 132k float adds ≈ 0.15 ms. Shipping it
would have re-bundled three apps for **1.015×**.

**This is §0 of that brief happening again, one rung up:** §0 said *don't trust a synthetic benchmark,
profile the real pipeline.* The correction is **don't trust a profile taken in the test harness's vm
realm either** — profile via `vm.runInThisContext` or a browser. Same lesson (`OxyDex`'s SampEn
`countMatches` reads as 15.9% of `compute()` in the vm realm and **~0%** in the main realm — do **not**
"fix" it).

**Action:** strike §3 from that brief and record the realm caveat in it, or the next session burns a
cycle shipping a 1.015× — using the very method that produced the wrong answer.

---

## 🟡 P1 · RUNTIME · **MED-HIGH** — PpgDex parses 190k timestamps it never reads (2.0× compute, byte-identical)

`ppgdex-dsp.js:103` calls `parseTimestamp(p[0])` on **every one of ~190,000 rows**; `t0Ms`/`firstTs`
are set once, and `lastTs` is read **only** in a `deltas.length <= 20` fallback that a real capture
(190k valid ns deltas) never takes. `parseSensorXYZ` (`:594`) does the same on the ACC/GYRO
companions — ~600k more dead calls, where `tMs` is read only when `relNs` is `NaN`, and `relNs` is
always finite on a real Polar file.

| | base | fix | export hash |
|---|---|---|---|
| `parsePPG` (n0612b, 190,535 rows) | 160.5 ms | **77.3 ms (2.08×)** | identical |
| companion parse (`acc0614` 16.2 MB + `gyro0614` 21.0 MB, 600k rows) | 487 ms | **234 ms (2.08×)** | identical |
| **`PpgDex.compute` end-to-end** (real 18-min capture) | 341.6 ms | **170.0 ms (2.01×)** | identical |

**Byte-identical by construction** (parse only while `t0Ms === null`; resolve `lastTs` lazily inside
the fallback). Verified: all three gated inputs hash unchanged.
**Gate impact:** `ppgdex-dsp.js` → rebuild `PpgDex` · `OverDex` · `Data Unifier`. Zero fixture movement.
**Land C1 + P1 as ONE PpgDex work-unit** — same bundle lock, and together they give 2.01× *and* fix `pi`.

---

## 🟡 D1 · DEV LOOP · **MED-HIGH** — the local gate is still single-threaded; CI is now faster than your laptop

Sharding shipped (PR #43) but only CI uses it. Locally:

| invocation | wall |
|---|---|
| `node tests/run-tests.mjs` | **102.4 s** (1 core of 6) |
| the same 4 shards forked in parallel | **28.1 s (3.6×)** |
| 6 shards | 27.0 s — no gain; the floor is the slowest group |

98% of `npm run check` is the suite (typecheck 1.14 s · biome 0.32 s · build-core 0.52 s ·
`build --check` 0.27 s · `verify-manifest` 0.06 s). And `--shard` is documented **nowhere a
contributor looks**: 0 hits in `CONTRIBUTING.md`, `tests/README.md`, `package.json` — CONTRIBUTING
§4.5 still sends you to the 102 s `npm test` after any `*-dsp.js` change.

**The change:** `run-tests.mjs --jobs=N` — fork N children over `planShards`, merge verdicts + exit
code (the partition proof already guarantees the union is the full gate), wired as `npm run test:par`.
**−74 s on every local gate run.** ~30 lines, no assertion changes.

---

## 🟡 D2 · DEV LOOP · **MED-HIGH** — two generated files serialize every PR, and a conflict silently yields *no CI at all*

`tests/docs-ledger-list.json` + `tests/changes-list.json` are touched by **62 of 139 commits (45%)**,
and **10 distinct merge commits in 48 h exist purely to re-resolve them**. The conflict is *structural,
not behavioural*: both carry scalar `count` and `generated: <date>` fields that change on **both** sides
of any concurrent add, so **the hunks conflict even when the arrays are disjoint**. `docs-ledger-list`
additionally carries a whole-tree 761-path inventory, so *any* file added anywhere rewrites it.

**This bit this very session, and the failure mode is nasty:** a conflicted PR goes `DIRTY`, and GitHub
builds `pull_request` runs against the **merge commit** — when that merge can't be created it dispatches
**nothing**. PR #43 sat with **zero checks** and no error anywhere; `workflow_dispatch` on the same
branch ran fine. You do not get a red — you get *silence*.

**The change:** store both as sorted newline-delimited text with **no `count`/`generated` fields**, plus
`.gitattributes: tests/*-list.txt merge=union`. Readers sort+dedupe; the existing Node-lane
`list == fs` assertion stays the backstop, so a bad union reds. **All 10 observed conflicts
auto-resolve.** No re-bundle, no fixture moves.

---

## 🟡 D3 · DEV LOOP · **MED** — a red gate prints 169 KB and names the failure once, on line 1651

Deliberate break (`MIN_SEP` 3600→1800, in a /tmp copy): the red run is **2,369 lines / 169,039 bytes**,
and **exactly one** line names the failure — at **line 1651 of 2369**. The final line is
`✕ 1 failing · 2086 passing · 11 skipped (134 groups)` — it does **not** name the failing group or
assertion, and there is no recap block. So `| tail -5` yields *zero* actionable information; an agent
must grep or slurp ~42k tokens, and in CI must `gh run view --log-failed` on the right shard.

**The change:** a trailing **FAILURES recap** (group ▸ assertion ▸ expected/actual ▸ the literal
`--group=<slug>` re-run line) and a `--quiet` mode, default-on in CI. Actionable read: **169 KB → <1 KB.**

---

## 🟢 D4 · DEV LOOP · **FIXED THIS PASS** — CI logs were silently truncated at 64 KB

`console.log` of a large payload followed by `process.exit()` **truncates on a pipe** (Node's stdout is
async to pipes, sync to files) — and CI captures stdout through a pipe. Measured on the pre-fix runner:

```
to FILE: 169,152 bytes     to PIPE: 65,536 bytes      ← exactly the pipe buffer
*** 103,616 bytes lost, including the summary line ***
```

The exit code was still correct, so the gate never lied — but **a failing assertion in a later group was
invisible in the CI log**, which is precisely when you need it. Fixed in PR #43 (`process.exitCode` +
let the stream drain). Verified the other CI gates emit 0.4–3 KB and were never at risk.

---

## 🟡 X1–X4 · DOCS · the most-read paragraph in the repo is wrong

- **X1 · HIGH — `CLAUDE.md` contradicts itself *and* the code on `manifestHash`.** `CLAUDE.md:222` still
  defines it as *"a projection of the bundle's `__bundler/manifest` … **gunzip each asset**"*. Thirty
  lines later `:251` says that branch was **RETIRED 2026-07-03**, and `manifest-gate.js:44` agrees
  (*"gzip+UUID format is RETIRED"*). `CONTRIBUTING.md:88` repeats the stale version **with no
  correction following it**. Fix `CLAUDE.md:220-227`; pointer-ize CONTRIBUTING §3.
- **X2 · HIGH — 4 `DOCS-INDEX.md` rows contradict their brief's header** (the header is the source of
  truth): `DOCS-LEDGER-GATE-FOLLOWUPS-2026-07-04` (DONE, indexed PROPOSED) ·
  `PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-2026-07-02` (DONE, indexed PROPOSED) ·
  `SELF-INGEST-FOLLOWUPS-2026-07-03` (DONE, indexed IN-PROGRESS) ·
  `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06` (IN-PROGRESS, indexed PROPOSED). The
  `docs-ledger` gate checks a brief *has a row* — never that the row **agrees**. `gen-docs-ledger-list.mjs`
  already parses the header for `check2a`, so adding `status` to the generated list + a `check3b ·
  index status ≡ header status` is **zero new compute**. It also turns *"what's open?"* into a small-file
  read instead of a **21k-token** `DOCS-INDEX.md` slurp.
- **X3 · MED — 19 unresolvable doc references, 6 of them in `CLAUDE.md`.** `CLAUDE.md:8` sends **every new
  session** to `INTEGRATOR-BUILD-BRIEF.md`, which lives at `briefs/INTEGRATOR-BUILD-BRIEF.md`. Each dead
  ref costs a failed Read → grep → retry. Residue of the sanctioned 2026-07-03 relocation, which updated
  the *gated* `DOCS-INDEX.md` and missed the *ungated* prose. Extend the existing link check (`check4b`)
  from `DOCS-INDEX.md` to all 7 root docs.
- **X4 · MED — `CONTRIBUTING.md` is a 3,879-word copy of `CLAUDE.md` that has already drifted.** It
  attributes **PulseDex to the Verity Sense** (the gate-backed roster says Polar H10 `*_RR.txt`; Verity is
  PpgDex), still calls the product **"GanglioR" / "ANS Intelligence"** (retired brand strings), and says
  *"~30 briefs"* when there are **174**. Cut to its non-duplicated core (§4.5 npm spine, §5 common-tasks
  table, §5.5 worker shim); pointer-ize the rest. Removes the last **ungated** copy of the roster.

---

## ⬜ Measured and DISMISSED — do NOT "optimize" these

- **Don't cache tsc, `npm ci`, or Playwright.** `npx -y tsc` in CI = **2 s including the download**;
  `npm ci` = **2 s**; a Playwright cache recovers only **3.9 s** of the 17.6 s install (the other 10.5 s
  is apt installing 9 genuinely-missing packages). And all of it is **latency-neutral**: `tests` (81 s) is
  the critical path; `no-network` (49 s), `types` (15 s), `biome` (13 s) all finish first, and the repo is
  public so minutes are free.
- **Don't add CI shards beyond 4.** The single slowest group (`ECGDex stampless events`, **19.6 s = 19% of
  the suite**) is the floor; top 6 groups = 64%. More shards buy **≤16 s**. The only lever left is that one
  group.
- **`PROFILED-HOTSPOTS §3` (the `mean` hoist) — 1.015×. Abandoned.** See M1.
- **OxyDex's SampEn/ApEn `O(n²)` loops** are explicitly capped (800/1000/300) and cost ~0 in a real realm.
  Their apparent hotness is a **vm-realm artifact** (M1).
- **`browser-gates.yml`** is `workflow_dispatch`-only and last ran 2026-07-08 — not on any PR path.
- Bundles are 444 KB–1.0 MB with no CDN/fonts — the "bundle bloat" class (charter §9) is **empty**.

## Hypotheses (labelled — do not size from these)
- **H1 — ECG parse.** `parseECGText` `split(/\r?\n/)` on a 181 MB string materialises 3.3 M line strings
  (GC = 15% of the profile). An index-scan parser measured **587 → 446 ms (1.32×)**, hash-identical, on a
  real 7 h night — but that is only **11% end-to-end** of a 1.25 s pipeline. The memory argument (no 3.3 M
  string allocation, on a phone) is likely worth more than the ms. **File only if you are already in
  `ecgdex-dsp.js`.**
- **H2 — `Data Unifier`/`OverDex` inline `ppgdex-dsp.js` but not `ppgdex-morph.js`.** If either routes a
  PPG file through the app path expecting morphology it would silently get none. A correctness question,
  not an efficiency one — not investigated.

---

## DO-FIRST

1. **C1 + P1 as one PpgDex work-unit** — fixes a wrong surfaced number **and** gives `compute()` 2.01×.
   Rebuild `PpgDex`/`OverDex`/`Data Unifier` under the bundle lock; all gated fixtures verified
   byte-identical.
2. **G1 — skip-budget assertion + `DEX_UPLOADS`.** The merge gate currently skips 13 of 23 provenance
   fixtures and nothing notices. This is the one that lets a real regression through.
3. **M1 — strike `PROFILED-HOTSPOTS §3` and record the vm-realm caveat**, before someone re-derives it.
4. **D1 — `--jobs=N`** (−74 s per local gate run) and **D2 — union-mergeable list files** (kills 10
   conflicts / 48 h and the silent no-checks failure).
5. **X1/X2 — fix the `manifestHash` paragraph and gate index-status ≡ header-status.**

Findings 1–2 are correctness/coverage. 3–5 are pure dev-loop cost. Nothing here trades a correct number
for speed — C1 and P1 both *improve* correctness or leave every byte identical.
