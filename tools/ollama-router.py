#!/usr/bin/env python3
# ollama-router.py — Tepna
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# One Ollama endpoint in front of two Ollama servers on the same 7900 XT: ROCm and Vulkan (RADV), plus optional CPU
# EMBED BOXES on the LAN. Owner 2026-11-09: "Prepare automatic switch based on what is running to have maximum performance."
# Written by Finch; moved into the repo 2026-11-22 (Kestrel, owner order). DEPLOY: the user unit runs ~/bin/ollama-router.py:
#     install -m 0755 tools/ollama-router.py ~/bin/ollama-router.py && systemctl --user restart ollama-router.service
# A restart drops every request in flight, so read GET /router/status first and restart while "inflight" is all 0.
# LAN addresses never live in this file: put ROUTER_EMBED_BOXES=name=host:port,... in ~/.config/tepna/ollama-router.env.
#
# MEASURED BASIS (2026-11-09, ollama 0.40.15, memory ollama-backend-verdict): Vulkan generates ~22 % faster, ROCm reads
# prompts 6–11 % faster, embeddings are identical; ONE backend switch costs 13–47 s (reloading a 16–18 GB model), so a
# per-request switch never pays. The policy therefore:
#   1. A model already resident stays where it is (sticky).
#   2. A model that is NOT resident (cold: first use, or after the 30-min idle unload) is loaded on the backend whose
#      predicted time for THIS request is lower — prompt tokens / prompt speed + expected output / generation speed.
#      A cold load costs the same either way, so this choice is free.
#   3. While resident, it moves only when the last WINDOW of traffic would have finished at least 2 × SWITCH_COST faster
#      on the other backend, after a minimum dwell, with nothing in flight.
#   4. Only one chat model is resident on the GPU: loading one unloads chat models on the other backend. Embedding models
#      (bge) are small and may sit beside it.
# Speeds per (model, backend) come from SPEEDS below; an unknown model falls back to DEFAULT (Vulkan). Every decision is logged.
# API: forwards /api/* and /v1/* unchanged (streaming relayed as it arrives); /api/ps and /api/tags merge both GPU servers;
# GET /router/status reports state. Python 3 stdlib only. The router itself binds 127.0.0.1 only.
import http.client, http.server, json, os, socketserver, sys, threading, time, collections, statistics

LISTEN = int(os.environ.get('ROUTER_PORT', '11434'))
BACKENDS = {'rocm': int(os.environ.get('ROCM_PORT', '11436')), 'vulkan': int(os.environ.get('VULKAN_PORT', '11435'))}
DEFAULT = os.environ.get('ROUTER_DEFAULT', 'vulkan')
LOG = os.path.expanduser(os.environ.get('ROUTER_LOG', '~/.local/state/finch/ollama-router.log'))
SWITCH_COST, WINDOW, DWELL = 40.0, 20 * 60, 20 * 60          # s; measured switch 13–47 s
SPEEDS = {  # (prompt tok/s, generation tok/s), measured 2026-11-09 (vk-probe.sh, uncached, median of 3)
    ('qwen3.8:27b', 'rocm'): (807, 57.7), ('qwen3.8:27b', 'vulkan'): (725, 70.7),
    ('qwen3-coder:30b', 'rocm'): (3229, 101.0), ('qwen3-coder:30b', 'vulkan'): (3032, 122.9),
}
EMBED_HINT = ('bge', 'embed', 'nomic', 'e5-', 'gte-')
EMBED_TIMEOUT = float(os.environ.get('ROUTER_EMBED_TIMEOUT', '12'))   # 2026-11-14: an embed gets this long from a backend, then the other one
# 2026-11-15 (board #6524): LANES. An embed with two or more inputs is BULK (the indexer): it goes to EMBED_BULK only, waits
# up to BULK_TIMEOUT and is never re-sent to the other backend. Before this, a batch slower than 12 s was sent again to the
# second backend while the first one went on computing it, so one index run filled both single-slot runners and every
# interactive query waited behind it. An embed with one input is INTERACTIVE: the other backend first, 12 s, then one retry.
EMBED_BULK = os.environ.get('ROUTER_EMBED_BULK', 'rocm')
BULK_TIMEOUT = float(os.environ.get('ROUTER_BULK_TIMEOUT', '900'))
# 2026-11-22 (owner order, Kestrel): EMBED BOXES. Two LXC containers on moxie and scale serve bge-m3 on the CPU (~55-70 ms
# a query from the rig). An INTERACTIVE embed of a BOX_MODELS model goes to them first, in turn, BOX_TIMEOUT s each, then to
# the local backends as before. Bulk embeds stay on EMBED_BULK. A box that times out is sick for SICK_FOR s and goes last.
ENV_FILE = os.path.expanduser(os.environ.get('ROUTER_ENV_FILE', '~/.config/tepna/ollama-router.env'))
if os.path.exists(ENV_FILE):   # KEY=VALUE lines; the process environment wins over the file
    for _line in open(ENV_FILE):
        _k, _, _v = _line.strip().partition('=')
        if _k and not _k.startswith('#') and _v: os.environ.setdefault(_k.strip(), _v.strip())
EMBED_BOXES = {}
for _item in os.environ.get('ROUTER_EMBED_BOXES', '').split(','):
    if '=' in _item:
        _n, _hp = _item.split('=', 1); _h, _, _pt = _hp.rpartition(':'); EMBED_BOXES[_n.strip()] = (_h, int(_pt))
BOX_MODELS = set(os.environ.get('ROUTER_BOX_MODELS', 'bge-m3:latest').split(','))
BOX_TIMEOUT = float(os.environ.get('ROUTER_BOX_TIMEOUT', '3'))
rr = [0]   # round-robin counter over EMBED_BOXES
SICK_FOR = 300; sick = {}   # backend -> time of its last embed timeout; for SICK_FOR seconds embeds try the other backend first
lock = threading.Lock()
inflight = collections.Counter()                      # backend -> requests in flight
history = collections.defaultdict(collections.deque)  # model -> deque of (t, prompt_tok, gen_tok)
placed = {}                                           # model -> (backend, since)

def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, 'a') as f: f.write(time.strftime('%Y-%m-%dT%H:%M:%S ') + msg + '\n')

def addr(be): return EMBED_BOXES[be] if be in EMBED_BOXES else ('127.0.0.1', BACKENDS[be])

def box_order(now):
    """The embed boxes for one interactive query: next in turn first, sick boxes last."""
    names = list(EMBED_BOXES)
    if not names: return []
    with lock: k = rr[0] % len(names); rr[0] += 1
    names = names[k:] + names[:k]
    return [b for b in names if now - sick.get(b, 0) >= SICK_FOR] + [b for b in names if now - sick.get(b, 0) < SICK_FOR]

def call(be, method, path, body=None, timeout=10):
    c = http.client.HTTPConnection('127.0.0.1', BACKENDS[be], timeout=timeout)
    c.request(method, path, body=body, headers={'Content-Type': 'application/json'} if body else {})
    r = c.getresponse(); data = r.read(); c.close(); return r.status, data

def resident():
    out = {}
    for be in BACKENDS:
        try: out[be] = [m['name'] for m in json.loads(call(be, 'GET', '/api/ps')[1]).get('models', [])]
        except Exception: out[be] = []
    return out

def n_inputs(req):
    i = req.get('input')
    return len(i) if isinstance(i, list) else 1

def embed_lane(req):
    """(backend, bulk?) for an embed request."""
    bulk = n_inputs(req) >= 2
    return (EMBED_BULK if bulk else next(b for b in BACKENDS if b != EMBED_BULK)), bulk

def is_embed(model, path): return 'embed' in path or any(h in model.lower() for h in EMBED_HINT)

def norm(model): return model if ':' in model else model + ':latest'

def predict(model, be, ptok, gtok):
    pp, gen = SPEEDS.get((norm(model), be), (None, None))
    if pp is None: return 0.0 if be == DEFAULT else 1.0       # unknown model: prefer the default
    return ptok / pp + gtok / gen

def expected_gen(model, req):
    n = (req.get('options') or {}).get('num_predict') or req.get('max_tokens')
    if n and n > 0: return n
    h = [g for _, _, g in history[norm(model)]]
    return statistics.median(h) if h else 300

def prompt_tokens(req):
    txt = req.get('prompt') or ''
    for m in req.get('messages') or []:
        c = m.get('content'); txt += c if isinstance(c, str) else json.dumps(c)
    return len(txt) / 4.0   # ~4 chars per token for English text (test 2026-11-09: 3.5 overestimated 2x on repetitive text)

def choose(model, path, req):
    model = norm(model); now = time.time(); res = resident()
    where = [be for be in BACKENDS if model in res[be]]
    if is_embed(model, path):
        be, bulk = embed_lane(req)
        return be, f'embed lane: {"bulk" if bulk else "interactive"} ({n_inputs(req)} input)'
    if where:
        be = where[0]; other = 'vulkan' if be == 'rocm' else 'rocm'
        h = [x for x in history[model] if now - x[0] <= WINDOW]
        saving = sum(predict(model, be, p, g) - predict(model, other, p, g) for _, p, g in h)
        since = placed.get(model, (be, now))[1]
        if saving > 2 * SWITCH_COST and now - since >= DWELL and inflight[be] == 0:
            return other, f'switch: last {WINDOW // 60} min would have run {saving:.0f} s faster on {other} (> 2 × {SWITCH_COST:.0f} s)'
        return be, 'resident (sticky)'
    p, g = prompt_tokens(req), expected_gen(model, req)
    t = {be: predict(model, be, p, g) for be in BACKENDS}
    be = min(t, key=t.get)
    return be, f'cold load: predicted {t["rocm"]:.1f} s ROCm vs {t["vulkan"]:.1f} s Vulkan for ~{p:.0f} prompt / {g:.0f} output tokens'

def make_room(model, be):
    """Before a chat model loads on `be`, unload chat models on the other backend (one chat model on the GPU)."""
    if is_embed(model, ''): return
    res = resident()
    for other in BACKENDS:
        for m in res[other]:
            if other != be and not is_embed(m, '') and inflight[other] == 0:
                try: call(other, 'POST', '/api/generate', json.dumps({'model': m, 'keep_alive': 0}).encode(), timeout=60); log(f'unloaded {m} from {other} to make room on {be}')
                except Exception as e: log(f'could not unload {m} from {other}: {e}')

class H(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def send_json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_HEAD(self): self.send_response(200); self.send_header('Content-Length', '0'); self.end_headers()
    def do_GET(self):
        if self.path == '/router/status':
            now = time.time()
            return self.send_json(200, {'resident': resident(), 'placed': placed, 'inflight': dict(inflight),
                                        'boxes': {b: {'addr': f'{h}:{pt}', 'sick': now - sick.get(b, 0) < SICK_FOR} for b, (h, pt) in EMBED_BOXES.items()},
                                        'speeds': {f'{m}|{b}': v for (m, b), v in SPEEDS.items()}})
        if self.path in ('/api/ps', '/api/tags'):
            models = []
            for be in BACKENDS:
                try:
                    for m in json.loads(call(be, 'GET', self.path)[1]).get('models', []):
                        if self.path == '/api/ps': m['backend'] = be; models.append(m)
                        elif not any(x['name'] == m['name'] for x in models): models.append(m)
                except Exception: pass
            return self.send_json(200, {'models': models})
        self.forward(DEFAULT, None)
    def do_DELETE(self): self.do_POST()
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else b''
        try: req = json.loads(body) if body else {}
        except Exception: req = {}
        model = req.get('model') or req.get('name') or ''
        if not model: return self.forward(DEFAULT, body)
        if req.get('keep_alive') in (0, '0', '0s') and not (req.get('prompt') or req.get('messages')):   # an unload (ollama stop)
            for be, ms in resident().items():
                if norm(model) in ms: return self.forward(be, body)
            return self.forward(DEFAULT, body)
        with lock:
            be, why = choose(model, self.path, req)
            if norm(model) not in resident()[be]:
                make_room(model, be); placed[norm(model)] = (be, time.time())
            inflight[be] += 1
        log(f'{self.path} {model} -> {be}: {why}')
        try: self.forward(be, body, model, bulk=is_embed(model, self.path) and embed_lane(req)[1])
        finally:
            with lock: inflight[be] -= 1
    def forward(self, be, body, model=None, bulk=False):
        # 2026-11-14 (board #6315): an EMBED that gets no answer from its backend in EMBED_TIMEOUT s is retried ONCE on the
        # other backend, before any byte went to the client. A hung ROCm runner then costs one timeout, not the fleet's search.
        emb = bool(model) and is_embed(model, self.path)
        tries = [be] + ([b for b in BACKENDS if b != be] if emb and not bulk else [])
        if emb and not bulk and time.time() - sick.get(be, 0) < SICK_FOR: tries.reverse()
        if emb and not bulk and norm(model) in BOX_MODELS: tries = box_order(time.time()) + tries
        r = None; err = None
        hdr = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'content-length', 'connection')}
        for b in tries:
            try:
                c = http.client.HTTPConnection(*addr(b), timeout=BOX_TIMEOUT if b in EMBED_BOXES else BULK_TIMEOUT if bulk else EMBED_TIMEOUT if emb else 1800)
                c.request(self.command, self.path, body=body, headers=hdr); r = c.getresponse()
                if b in EMBED_BOXES and r.status != 200:
                    st = r.status; r.read(); c.close(); r = None
                    if st >= 500: sick[b] = time.time()   # a 4xx is the request's fault, not the box's
                    log(f'{self.path} {model}: box {b} answered http {st}; trying the next one'); continue
                if b != be and b not in EMBED_BOXES: log(f'{self.path} {model}: embed served by {b} ({be} is marked sick or gave no answer in {EMBED_TIMEOUT:g} s)')
                break
            except Exception as e:
                err = e; r = None
                if emb and not bulk: sick[b] = time.time()
                if emb: log(f'{self.path} {model}: no answer from {b} in {BOX_TIMEOUT if b in EMBED_BOXES else BULK_TIMEOUT if bulk else EMBED_TIMEOUT:g} s ({type(e).__name__}{", bulk" if bulk else ""})')
        if r is None:
            return self.send_json(502, {'error': f'router: backend {be} unreachable: {err}'})
        self.send_response(r.status)
        for k, v in r.getheaders():
            if k.lower() not in ('content-length', 'transfer-encoding', 'connection'): self.send_header(k, v)
        self.send_header('Transfer-Encoding', 'chunked'); self.end_headers()
        last = b''
        while True:
            chunk = r.read1(65536) if hasattr(r, 'read1') else r.read(65536)
            if not chunk: break
            last = (last + chunk)[-8192:]
            self.wfile.write(b'%x\r\n' % len(chunk) + chunk + b'\r\n'); self.wfile.flush()
        self.wfile.write(b'0\r\n\r\n'); self.wfile.flush(); c.close()
        if model:   # learn the traffic shape from ollama's own counters in the final object
            try:
                fin = json.loads(last.strip().split(b'\n')[-1])
                p, g = fin.get('prompt_eval_count'), fin.get('eval_count')
                if p is None and 'usage' in fin: p, g = fin['usage'].get('prompt_tokens'), fin['usage'].get('completion_tokens')
                if p is not None:
                    h = history[norm(model)]; h.append((time.time(), p, g or 0))
                    while h and time.time() - h[0][0] > WINDOW: h.popleft()
            except Exception: pass

class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True; allow_reuse_address = True

if __name__ == '__main__':
    if '--selftest' in sys.argv:
        assert norm('bge-m3') == 'bge-m3:latest' and is_embed('bge-m3:latest', '/api/generate')
        assert predict('qwen3.8:27b', 'vulkan', 100, 500) < predict('qwen3.8:27b', 'rocm', 100, 500)        # chat → Vulkan
        assert predict('qwen3.8:27b', 'rocm', 60000, 20) < predict('qwen3.8:27b', 'vulkan', 60000, 20)       # long prompt, short answer → ROCm
        assert predict('unknown:1b', DEFAULT, 9, 9) < predict('unknown:1b', 'rocm' if DEFAULT == 'vulkan' else 'vulkan', 9, 9)
        other = next(b for b in BACKENDS if b != EMBED_BULK)
        assert embed_lane({'input': ['a', 'b']}) == (EMBED_BULK, True) and embed_lane({'input': ['a']}) == (other, False)
        assert embed_lane({'input': 'a'}) == (other, False) and embed_lane({}) == (other, False)
        EMBED_BOXES.clear(); EMBED_BOXES.update({'a': ('192.0.2.1', 1), 'b': ('192.0.2.2', 2)})   # TEST-NET-1, never routed
        o1, o2 = box_order(0), box_order(0)
        assert o1[0] != o2[0] and sorted(o1) == ['a', 'b']                                          # boxes alternate
        sick[o1[0]] = time.time(); assert box_order(time.time())[-1] == o1[0]; sick.clear()       # sick box goes last
        assert addr('a') == ('192.0.2.1', 1) and addr('rocm') == ('127.0.0.1', BACKENDS['rocm'])
        print('ollama-router selftest ok'); sys.exit(0)
    log(f'start: listen {LISTEN}, backends {BACKENDS}, default {DEFAULT}')
    S(('127.0.0.1', LISTEN), H).serve_forever()
