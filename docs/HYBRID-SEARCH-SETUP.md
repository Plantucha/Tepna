<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Hybrid search — making the lane survive a reboot

`node tools/doc-search.mjs --hybrid "<question>"` answers from a **local, loopback-only** search index
holding BM25 text and the bge-m3 vectors doc-search has already cached. **Rule 0's default path does not
use it** and is unaffected by everything on this page; adoption is the owner's call
(`briefs/XERJ-HYBRID-SEARCH-2026-10-10-BRIEF.md`).

Primary development machine only. Measured 2026-10-10: the index server was a bare process started by
hand, so a reboot or a closed terminal ended the hybrid lane silently — the flag fails with a connection
error while the default path keeps working, which is an outage that pages nobody.

## Enable it — the OWNER does this; a session must not

```sh
mkdir -p ~/.local/share/tepna/hybrid-index
cp tools/systemd/tepna-hybrid-index.service        ~/.config/systemd/user/
cp tools/systemd/tepna-hybrid-index-reload.service ~/.config/systemd/user/
cp tools/systemd/tepna-hybrid-index-reload.timer   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tepna-hybrid-index.service          # the server
systemctl --user enable --now tepna-hybrid-index-reload.timer     # rebuild the generation, nightly at 03:20
node tools/xerj-load.mjs                                          # the first fill (~56–77 s)
node tools/doc-search.mjs --hybrid "a question"                   # the one-line check
```

### The board lane — new board posts in search within minutes (owner, 2026-10-31)

```sh
cp tools/systemd/tepna-board-search.service ~/.config/systemd/user/
cp tools/systemd/tepna-board-search.timer   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tepna-board-search.timer            # every 5 min
```

The tick runs `tools/bge-reindex-driver.sh --board`: the board export, an embed of what changed, and
`xerj-load.mjs --only ext:agent-board/ --newer-than 10`. That load upserts into the generation that
serves the alias now, and it never builds or promotes one. The nightly rebuild stays the source of truth.
A quiet tick reports `NOT_APPLICABLE` and writes no log line.

## The reranker server — the OWNER enables it too

Rule 0 asks this server on every hybrid search (owner, 2026-10-12). It scores the fused top 20 and
refuses a search whose best score is under 0.105. It never changes the order of the hits. When the
server does not answer, the search uses the cosine and BM25 floor and prints one line that says so.

```sh
# stop the hand-started server first: it holds port 8091
ln -s ~/Tepna/tools/systemd/tepna-rerank.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tepna-rerank.service
curl -s http://127.0.0.1:8091/health                              # {"status":"ok"}
node tools/doc-search.mjs --brief "a question"                    # prints "reranker best score"
```

| floor | answerable refused | off-topic refused | hold-out off-topic refused |
|---|---|---|---|
| cosine and BM25 | 1 of 52 | 38 of 40 | 18 of 20 |
| reranker | 1 of 52 | 40 of 40 | 20 of 20 |

`node tools/doc-search.mjs --no-rerank "…"` uses the old floor by name.
`node tools/xerj-bench.mjs --refusal --rerank` repeats the measurement.

## What the three units are, and the two properties that matter

| unit | what it does |
|---|---|
| `tepna-hybrid-index.service` | the server. `Restart=on-failure`, loopback-bound, `Nice=10`/idle I/O so it never outranks a gate |
| `tepna-hybrid-index-reload.service` | one refill from the vector cache. **Fails on a load of zero** |
| `tepna-hybrid-index-reload.timer` | **nightly at 03:20**, with a 600 s jitter. It ran hourly until 2026-11-05 |

**The rebuild runs nightly because the hourly one stalled searches.** Each rebuild loads the whole
corpus beside the serving index. The owner moved it to 03:20 on 2026-11-05. Freshness between
rebuilds comes from the hourly re-embed (`bge-reindex.timer`, which runs
`tools/bge-reindex-driver.sh`) and from the 5-minute board tick. Both upsert into the serving
generation.

**Loopback is the reason the server runs without TLS.** The listener binds `127.0.0.1` (the engine's own
default; exposing it needs a separate opt-in), and the unit enforces the same thing at the kernel with
`IPAddressAllow=localhost` / `IPAddressDeny=any` rather than trusting an argument. If the bind address
ever changes, the `--insecure` flag must change in the same edit — they are one decision.

**Source only.** The documents come from doc-search's own corpus, and the loader additionally refuses any
path matching `uploads/`, `.edf`, `captures/` or `.dat|.bin|.wav`. Nothing recorded enters this index.

**Nothing downloads a model.** The vectors are ours, computed by doc-search against the loopback inference
server; the engine runs in lexical mode and never embeds.

## It survives a restart — measured, not assumed

2026-10-10, on a second instance so the running one was untouched: **54,180 documents loaded in 55.8 s**
(peak RSS 343 MB, 382 MB on disk), the process killed, restarted on the same data directory, and
**54,180 documents still served**. A count only proves documents, so a kNN query was run after the
restart and returned the right passages — the **vectors** persisted, not merely the row count.

## If `--hybrid` fails

* `xerj HTTP …` or a connection error → the server is down: `systemctl --user status tepna-hybrid-index`
* hits look stale → run `node tools/xerj-load.mjs` (the timer does this nightly at 03:20). Each run
  builds a FRESH `tepna-hybrid-<stamp>` index, moves the name `tepna-hybrid` to it, and deletes the
  replaced one.
  Reloading INTO one index is what the loader did until 2026-10-11, and the engine's vector graph never
  reclaims an overwrite: one index grew to 9.7 GB on disk and the server to 11.3 GB RSS.
* searches take seconds, or the loader reports the engine's memory breaker → `du -sh
  ~/.local/share/tepna/hybrid-index/*` — a `tepna-hybrid` directory (a real index wearing the alias's
  name) is the pre-2026-10-11 shape; one run of the loader replaces it.
* searches take seconds, and the engine logs no `slow search_inner` WARN → the engine never saw the
  cost. Read that count first: `journalctl --user -u tepna-hybrid-index --since -1h | grep -c 'slow
  search_inner'`. A count over zero means the engine was slow. A zero count puts the time in the
  query embed, which is doc-search's own work and not the engine's.
* the query embed is the slow part → read `curl -s localhost:11434/api/ps`. A `size_vram` of 0 is a
  CPU copy of the embed model. And doc-search embeds on the CPU itself when free VRAM is under
  `DEX_EMBED_MIN_FREE_MB`, 4096 MB by default. Set `DEX_EMBED_CPU=0` to force the GPU lane for one
  query.
* `loaded 0 documents` → **this is a failure, not a quiet success**: the cache, the corpus or the
  staleness rule stopped matching. The skip histogram in the output says which.
* `⚠ no reranker (…)` under the hits → the reranker server is down: `systemctl --user status tepna-rerank`.
  The search still answers, on the old floor.
* nothing is wrong with Rule 0 — re-run without `--hybrid` and the default path answers as always.

**Measured 2026-11-12, the outage that produced the discriminator above.** A CPU-only embed model
took one query past the 10 s hybrid budget. Each refusal then started a semantic fallback on the same
CPU. Four of them together held the next embed past 600 s, with the card idle at 19 GB free. The same
query answered in 1 s with the model on the card at 657 MiB.
