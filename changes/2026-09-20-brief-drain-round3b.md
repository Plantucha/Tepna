---
bump: patch
type: changed
brief: none
---

Three genuinely open briefs re-verified against current `main`. **Two stamped, one unchanged.**

## 🔴 `VIGIL-OFFLOAD-AND-RETENTION` — its own next step would have been destructive until yesterday

The brief is parked on an **owner ruling of 2026-09-07: NOT approved**, and the header says so precisely
*"so the decision is not re-raised as though it were still open."* **That ruling stands and this stamp
does not re-open it.**

What changed is beneath it. The plan ends in *"Heron (config + first pruned round-trip)"* over a
**transfer** target — and verified at the source across #2702:

```
before:  archive_enabled = bool(acfg.get("enabled")) and bool(acfg.get("dest"))
```

A transfer (rsync-over-SSH) config is **`target`-only, with no `dest`** — so the gate was **False**,
`plan_prune` (age-based by design) ran **with nothing protecting it**, and nights flattened into one
directory. #2702 fixed both, and records why a marker-only gate would not have sufficed either: an
`.archived` marker says a copy was once **made**, not that it still **exists**, and on this box **6 of 10
nights carried it while the backup volume was absent**.

**So a precondition was repaired, not a decision changed.** The distinction is the whole point of the
stamp: the brief's remaining step is materially safer than when the ruling was made, and that is
information for *if* it is revisited — not an argument that it should be.

## `OXYII-ACQUISITION-CHARTER` — the G4 sample more than doubled

I verified G4's real-night half on 2026-09-05 at **13 nights**. Re-read 2026-09-20: **28 nights carry
`OXYLIFE.csv`, 2026-08-24 → 2026-09-20**. The instrument has run unbroken for four further weeks, so the
sample behind G4 is no longer the one the header describes.

⚠️ **G5 and §50 are unchanged, and the limit is stated rather than glossed:** G5 needs the ring **worn
during a live pull**, and **I counted nights, not worn-during-pull events** — a file census cannot
confirm it. §50 still needs the owner's attestation.

## `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` — verified unchanged, no edit

§6's blocker is **procurement, not engineering**: every constant derives from one physical unit, and
nothing can show them to be properties of the model until a second ring exists. **Still exactly 1
distinct ring serial repo-wide.** Header correct; editing it would add noise to a file that is already
right.

⚠️ **One limit worth naming because it looks like corroboration and is not:** my box-side serial grep
returned **0**, which is my pattern not matching the capture directory's naming — **not evidence of
absence**. The repo-wide count of 1 is the measurement; the box grep examined nothing.
