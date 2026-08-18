---
bump: patch
type: fixed
---

**The configured archive destination cannot free any space, and the disk emergency the brief was
written for is ~6.6 months away.** `VIGIL-OFFLOAD-AND-RETENTION` re-measured against the live box.

| | measured 2026-08-17 |
|---|---|
| disk | 233 G total, **188 G free** (16 % used) |
| captures | **22.7 G / 24 nights** → **0.95 GB/night** |
| runway | **198 nights ≈ 6.6 months** |
| `storage.keep_nights` | **0** — retention OFF, deliberately |

⚠️ **`dest: /srv/tepna/archive` is inert.** The directory does not exist; if created it resolves to
`/dev/mapper/ubuntu--vg-ubuntu--lv` — **the same filesystem as the captures it would archive** — and
there is **no off-box mount of any kind** (`findmnt -t nfs,cifs,nfs4` returns nothing).

So a reader checking that `dest` is set would conclude offload is configured. It is configured and
inert: archiving today copies bytes between two directories on one disk. The archive-bypass recorded
elsewhere as *latent* is confirmed latent, with the reason — there is nowhere for the bytes to go.

**Sequencing, not requirement, is what changes.** No disk emergency inside ~6 months means the offload
target can be chosen deliberately. And `keep_nights` **must not** leave 0 until a verified off-box copy
exists, or pruning deletes the only copy — the brief's `Done when` ordering already says this, and the
measurement confirms there is time to honour it.

The eight open boxes are **owner decisions** (buy a production box, choose transport, root-level SSH or
`fstab` setup, confirm the drive class), not pending engineering. Recorded rather than executed around.
