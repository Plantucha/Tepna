#!/bin/bash
# ollama-router-watch.sh — Tepna
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# Written by Finch; moved into the repo 2026-11-22 (Kestrel, owner order). DEPLOY: the timer runs ~/bin/ollama-router-watch.sh:
#     install -m 0755 tools/ollama-router-watch.sh ~/bin/ollama-router-watch.sh
# Is the Ollama endpoint on 11434 alive? Owner 2026-11-10: "If it dies Kestrel and Finch
# have to be notified." Run by ollama-router-watch.timer every 2 min, and at once by OnFailure= of the router units.
# Mode follows what is installed: router enabled → router (11434) + both backends (11436 ROCm, 11435 Vulkan) + units;
# otherwise the single system ollama on 11434. Two strikes before an alert (a backend restart takes ~3 s, a slow
# model load can stall /api/version briefly); one good check clears. Posts ONLY on a state change, to the rig-alert
# thread (#13) addressed to Kestrel (who escalates to the owner's phone through ntfy-owner) and naming @finch.
# Never publishes to an ntfy topic itself: the owner channel is Kestrel's (ntfy-owner header).
set -u
S=${WATCH_STATE:-$HOME/.local/state/finch}; mkdir -p "$S"; P1=${WATCH_PORT:-11434}   # overrides: test only
 ST=$S/ollama-router-watch.state; LOG=$S/ollama-router-watch.log
now=$(date -Is); probe() { curl -s -m 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$1/api/version" 2>/dev/null; }
bad=()
if systemctl --user is-enabled -q ollama-router.service 2>/dev/null; then
  mode=router
  for u in ollama-router ollama-rocm ollama-vulkan; do systemctl --user is-active -q $u || bad+=("$u $(systemctl --user is-active $u)"); done
  for p in 11434:router 11436:rocm 11435:vulkan; do c=$(probe ${p%%:*}); [ "$c" = 200 ] || bad+=("${p#*:} :${p%%:*} http ${c:-none}"); done
  # 2026-11-12: a backend can answer /api/version while its embeds hang (bge-m3 stranded on CPU in Vulkan, 8 requests
  # stuck, doc-search rc 124 for ~1 h, board #5941/#5943). So also time one real embed through the router: 25 s cap
  # (a cold bge load measured 8.4 s).
  e=$(curl -s -m 25 -o /dev/null -w '%{http_code} %{time_total}' -d '{"model":"bge-m3","input":"watch"}' "http://127.0.0.1:11434/api/embed" 2>/dev/null)
  [ "${e%% *}" = 200 ] || bad+=("embed bge-m3 :11434 http ${e:-none} (doc-search embeddings hang or fail)")
else
  mode=single; c=$(probe "$P1"); [ "$c" = 200 ] || bad+=("ollama :$P1 http ${c:-none}")
fi
prev=good; strikes=0; [ -f "$ST" ] && read -r prev strikes < "$ST"
if [ ${#bad[@]} -eq 0 ]; then
  [ "$prev" = bad ] && msg="RECOVERED: Ollama endpoint ($mode mode) answers again; doc-search embeddings and Qwen reachable. @finch"
  echo "good 0" > "$ST"
else
  strikes=$((strikes + 1)); reason=$(IFS='; '; echo "${bad[*]}")
  echo "$now $mode strike $strikes: $reason" >> "$LOG"
  if [ "$prev" != bad ] && [ $strikes -ge 2 ]; then
    msg="DOWN: Ollama endpoint ($mode mode) failing 2 checks: $reason. doc-search embeddings and Qwen are unreachable. Check: systemctl --user status ollama-router ollama-rocm ollama-vulkan; log ~/.local/state/finch/ollama-router.log. Rollback: ~/bin/rollback-ollama-router.sh (sudo, owner). @finch"
    echo "bad $strikes" > "$ST"
  else echo "$prev $strikes" > "$ST"; fi
fi
if [ -n "${msg:-}" ]; then
  echo "$now $msg" >> "$LOG"
  [ -n "${WATCH_DRY:-}" ] && { echo "DRY: $msg"; exit 0; }
  timeout 60 ~/.local/bin/agent-board --as finch post --kind finding --to kestrel 13 "$(echo "$msg" | tr -d "'\"")" >/dev/null 2>&1 \
    || echo "$now board post failed" >> "$LOG"
fi
# 2026-11-22 (Kestrel, owner order): two more checks, each with its own state file, run in router mode only.
# (a) A HUNG GPU BACKEND. The router hides a hung ROCm runner by failing over to Vulkan, so the check above stays green.
#     Time one 1-input embed straight to each backend, but only while the router has nothing in flight there: a bulk
#     index batch holds the runner for minutes, and a probe behind it is not a hang. Two strikes in a row restart that
#     user unit (owner 2026-11-15: Kestrel restarts a wedged rig Ollama user unit without asking) and post the result.
#     At most one restart per backend per 30 min (Finch review #7879).
# (b) THE EMBED BOXES named in the router status. A dead box costs nothing visible (the router falls back to the GPU),
#     so post DOWN after BOX_STRIKES failed checks in a row (8 × 2 min ≈ 16 min) and RECOVERED on the first good one.
#     Every box failing in one run posts at once: then each interactive query waits on the GPU again.
# (c) SAME VECTORS, once an hour: the index is embedded on ROCm and queries come from the boxes. Three texts on each box
#     and on an idle GPU backend must give the same dimension and cosine >= 0.999. A different build, quantisation or
#     context length would lower search quality with no error (Finch review #7879). Measured 2026-11-22: 1.00000 × 3.
post() {
  echo "$now $1" >> "$LOG"
  [ -n "${WATCH_DRY:-}" ] && { echo "DRY: $1"; return; }
  timeout 60 ~/.local/bin/agent-board --as finch post --kind finding --to kestrel 13 "$(echo "$1" | tr -d "'\"")" >/dev/null 2>&1 \
    || echo "$now board post failed" >> "$LOG"
}
if [ "$mode" = router ] && st=$(curl -s -m 8 http://127.0.0.1:11434/router/status 2>/dev/null) && [ -n "$st" ]; then
  for p in rocm:11436 vulkan:11435; do
    be=${p%%:*}; port=${p#*:}; f=$S/watch-$be.strikes; n=0; [ -f "$f" ] && read -r n < "$f"
    busy=$(echo "$st" | python3 -c "import json,sys; print(json.load(sys.stdin)['inflight'].get('$be', 0))" 2>/dev/null)
    [ "${busy:-1}" = 0 ] || { echo 0 > "$f"; continue; }
    c=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -d '{"model":"bge-m3","input":["watch"],"keep_alive":"30m"}' "http://127.0.0.1:$port/api/embed" 2>/dev/null)
    if [ "$c" = 200 ]; then echo 0 > "$f"; continue; fi
    n=$((n + 1)); echo "$now $be direct embed http ${c:-none}, strike $n" >> "$LOG"
    last=0; [ -f "$S/watch-$be.restarted" ] && read -r last < "$S/watch-$be.restarted"
    if [ $n -ge 2 ] && [ $(( $(date +%s) - last )) -lt 1800 ]; then
      echo "$now $be: restart held, the last one was under 30 min ago" >> "$LOG"
    elif [ $n -ge 2 ]; then
      date +%s > "$S/watch-$be.restarted"
      if [ -n "${WATCH_DRY:-}" ]; then r=dry; else systemctl --user restart ollama-"$be".service; sleep 5
        r=$(curl -s -m 30 -o /dev/null -w '%{http_code} %{time_total}s' -d '{"model":"bge-m3","input":["watch"]}' "http://127.0.0.1:$port/api/embed" 2>/dev/null); fi
      post "RESTARTED: ollama-$be.service, because 2 direct 1-input embeds on :$port got no answer in 20 s while the router had nothing in flight there. After the restart the embed answered: ${r:-none}. @finch"
      n=0
    fi
    echo $n > "$f"
  done
  BOX_STRIKES=${BOX_STRIKES:-8}; nbox=0; nfail=0
  for b in $(echo "$st" | python3 -c "import json,sys; [print(k + '=' + v['addr']) for k, v in json.load(sys.stdin).get('boxes', {}).items()]" 2>/dev/null); do
    name=${b%%=*}; hp=${b#*=}; f=$S/watch-box-$name.state; bs=good; n=0; [ -f "$f" ] && read -r bs n < "$f"
    c=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -d '{"model":"bge-m3","input":["watch"]}' "http://$hp/api/embed" 2>/dev/null)
    nbox=$((nbox + 1)); [ "$c" = 200 ] || nfail=$((nfail + 1))
    if [ "$c" = 200 ]; then
      [ "$bs" = bad ] && post "RECOVERED: embed box $name answers bge-m3 again. @finch"
      echo "good 0" > "$f"
    else
      n=$((n + 1)); echo "$now box $name embed http ${c:-none}, strike $n" >> "$LOG"
      if [ "$bs" != bad ] && [ $n -ge "$BOX_STRIKES" ]; then
        post "DOWN: embed box $name failed $n checks in a row (last: http ${c:-none}). The router sends its queries to the other box or the GPU. Check: ssh to its Proxmox host, then pct status and the ollama unit in the container. @finch"
        bs=bad
      fi
      echo "$bs $n" > "$f"
    fi
  done
  f=$S/watch-allboxes.state; ab=good; [ -f "$f" ] && read -r ab < "$f"
  if [ $nbox -gt 0 ] && [ $nfail -eq $nbox ]; then
    [ "$ab" = bad ] || post "DOWN: every embed box ($nbox) failed this check. Each interactive embed now waits on the GPU. @finch"
    echo bad > "$f"
  elif [ $nbox -gt 0 ]; then
    [ "$ab" = bad ] && post "RECOVERED: at least one embed box answers again ($((nbox - nfail)) of $nbox). @finch"
    echo good > "$f"
  fi
  pf=$S/watch-parity.last; pl=0; [ -f "$pf" ] && read -r pl _ < "$pf"
  if [ $nbox -gt 0 ] && [ $(( $(date +%s) - pl )) -ge 3600 ]; then
    res=$(echo "$st" | python3 -c '
import json, math, sys, urllib.request
st = json.load(sys.stdin); T = ["how does the walker undraft a green PR", "floating wall-clock ms", "absence is null"]
def emb(hp):
    q = urllib.request.Request(f"http://{hp}/api/embed", data=json.dumps({"model": "bge-m3", "input": T}).encode())
    return json.load(urllib.request.urlopen(q, timeout=30))["embeddings"]
r = None
for be, hp in (("rocm", "127.0.0.1:11436"), ("vulkan", "127.0.0.1:11435")):
    if st["inflight"].get(be, 0): continue
    try: r = emb(hp); break
    except Exception: pass
if r is None: print("skip"); sys.exit()
bad = []
for name, v in st.get("boxes", {}).items():
    if v["sick"]: continue
    try: e = emb(v["addr"])
    except Exception: continue
    cs = [sum(a * b for a, b in zip(x, y)) / math.sqrt(sum(a * a for a in x) * sum(b * b for b in y)) for x, y in zip(r, e)]
    if len(e[0]) != len(r[0]) or min(cs) < 0.999: bad.append(f"{name} dim {len(e[0])} vs {len(r[0])}, min cosine {min(cs):.5f}")
print("bad " + "; ".join(bad) if bad else "ok")
' 2>/dev/null)
    case "$res" in
      ok) echo "$(date +%s) ok" > "$pf" ;;
      bad*) [ "$(cut -d' ' -f2 "$pf" 2>/dev/null)" = bad ] || post "MISMATCH: embed box vectors differ from the GPU index backend: ${res#bad }. Search quality drops with no error. Check the ollama version and the bge-m3 build on the box. @finch"
            echo "$(date +%s) bad" > "$pf" ;;
    esac
  fi
fi
exit 0
