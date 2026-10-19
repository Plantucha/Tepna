#!/usr/bin/env python3
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# seqnet_export.py — export a SeqNet (seqnet.py's architecture) to a dependency-free JSON weights file, and
# write golden vectors for the JS port's parity test. With --random it builds a seeded random model so the
# PORT's arithmetic can be proven before any trained weights exist; with --state <pt> it exports a trained one.
import argparse, json, sys, os
import numpy as np, torch

_pre = argparse.ArgumentParser(add_help=False); _pre.add_argument('--seqnet-dir', required=True, help='directory holding seqnet.py (the research trainer, outside this repo)')
_known, _ = _pre.parse_known_args(); sys.path.insert(0, _known.seqnet_dir)
import seqnet as S  # noqa: E402

def export_state(model, meta, fp16=False):
    layers = {}
    for name, t in model.state_dict().items():
        a = t.detach().cpu().numpy().astype(np.float32)
        if fp16: a = a.astype(np.float16).astype(np.float32)
        layers[name] = {'shape': list(a.shape), 'data': [float(x) for x in a.ravel()]}
    return {'format': 'tepna-seqnet/1', 'arch': {'K': S.K, 'ch': 64, 'k': 5, 'dilations': [1, 2, 4, 8, 16, 32], 'groupnorm_groups': 8, 'gn_eps': 1e-5},
            'meta': meta, 'layers': layers}

ap = argparse.ArgumentParser(parents=[_pre]); ap.add_argument('--random', action='store_true'); ap.add_argument('--kin', type=int, default=20)
ap.add_argument('--state', default=None); ap.add_argument('--out', required=True); ap.add_argument('--golden', default=None)
ap.add_argument('--T', type=int, default=300); ap.add_argument('--seed', type=int, default=7)
ap.add_argument('--meta-from-cache', default=None); ap.add_argument('--meta-cohort', default='ucddb'); ap.add_argument('--drop', default=None)
ap.add_argument('--fp16', action='store_true', help='round weights to float16 (≈4× smaller file; parity measured within the 2e-3 band)'); a = ap.parse_args()
torch.manual_seed(a.seed); np.random.seed(a.seed)
if a.random:
    meta = {'random': True, 'seed': a.seed, 'kin': a.kin}
    if a.meta_from_cache:  # exercise the real-night pipeline with random weights: derive names/blocks/kin from the cache like seqnet.main()
        import re; names_all = json.load(open(S.glob_names(a.meta_from_cache, a.meta_cohort, 'oxy1')))['names']
        keep = [j for j, nm in enumerate(names_all) if not (a.drop and re.search(a.drop, nm))]; keep_names = [names_all[j] for j in keep]
        bc = [[j for j, nm in enumerate(keep_names) if nm.startswith(p)] for p in S.BLOCK_PREFIXES]
        meta.update({'names': keep_names, 'block_prefixes': list(S.BLOCK_PREFIXES), 'block_cols': bc, 'presence': True, 'drop': a.drop, 'group_subjects': True,
                     'logT': np.log(np.full((S.K, S.K), 0.25)).tolist(), 'logPrior': np.log(np.full(S.K, 0.25)).tolist()}); a.kin = len(keep_names) + 1 + len(bc); meta['kin'] = a.kin
    model = S.SeqNet(a.kin)
else:
    blob = torch.load(a.state, map_location='cpu'); st = blob['state'] if 'state' in blob else blob; kin = st['stem.weight'].shape[1]; model = S.SeqNet(kin); model.load_state_dict(st)
    meta = {'random': False, 'kin': kin, 'state': a.state, 'group_subjects': True}; meta.update(blob.get('meta', {}))
model.eval()
meta['fp16'] = bool(a.fp16)
json.dump(export_state(model, meta, a.fp16), open(a.out, 'w'))
print('weights →', a.out, 'params', sum(p.numel() for p in model.parameters()))
if a.golden:
    kin = meta['kin']; X = np.random.randn(a.T, kin).astype(np.float32) * 1.5
    X[:, -1] = 1.0  # a presence-like column
    with torch.no_grad():
        xt = torch.from_numpy(X)[None]
        stem = model.stem(xt.transpose(1, 2)); after0 = model.blocks[0](stem); allb = model.blocks(stem)
        h, _ = model.gru(allb.transpose(1, 2)); logits = model.out(h)
    g = {'T': a.T, 'kin': kin, 'x': X.tolist(), 'stem': stem[0].T.numpy().tolist(), 'block0': after0[0].T.numpy().tolist(),
         'blocks': allb[0].T.numpy().tolist(), 'gru': h[0].numpy().tolist(), 'logits': logits[0].numpy().tolist(),
         'proba': torch.softmax(logits[0], -1).numpy().tolist()}
    json.dump(g, open(a.golden, 'w')); print('golden →', a.golden)
