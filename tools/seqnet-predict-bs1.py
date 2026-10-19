#!/usr/bin/env python3
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# predict_bs1.py — the Python net on the fold-0 test nights ONE NIGHT AT A TIME (no padding), saving probabilities the
# same way seqnet.py --save-proba does, plus a fold JSON in bench format. Diagnoses the batch-padding artefact: the
# saved v20-style probas come from batches of 32 padded to the longest night, so GroupNorm, the dilated convs and the
# backward GRU all see a zero tail that a per-night deployment never has.
import sys, os, json, re, time, numpy as np, torch
sys.path.insert(0, os.path.expanduser('~/stagetest')); import seqnet as S
cache = os.path.expanduser('~/stagetest/lab-cache'); out = os.path.join(cache, 'bench-port', 'proba-bs1'); os.makedirs(out, exist_ok=True)
blob = torch.load(os.path.expanduser('~/stagetest/port/fold0.pt'), map_location='cpu'); meta = blob['meta']
S.GROUP_SUBJECTS = True; S.PRESENCE = True
cohorts = meta['cohorts'].split(','); nights = S.load(cache, cohorts, meta['features'])
names_all = json.load(open(S.glob_names(cache, nights[0]['cohort'], meta['features'])))['names']
rx = re.compile(meta['drop']); S.KEEP = [j for j, nm in enumerate(names_all) if not rx.search(nm)]
keep_names = [names_all[j] for j in S.KEEP]; assert keep_names == meta['names'], 'feature names drifted'
S.BLOCK_COLS = [[j for j, nm in enumerate(keep_names) if nm.startswith(p)] for p in S.BLOCK_PREFIXES]
test = [t for t in nights if S.fold_of(t['cohort'], t['id']) == meta['fold']]
model = S.SeqNet(blob['state']['stem.weight'].shape[1]); model.load_state_dict(blob['state']); model.eval()
torch.set_num_threads(int(os.environ.get('THREADS', '6')))
logT = np.array(meta['logT']); logPrior = np.array(meta['logPrior']); rows = []; t0 = time.time()
with torch.no_grad():
    for i, t in enumerate(test):
        X = torch.from_numpy(S.tensorise(t))[None]
        P = torch.softmax(model(X), -1)[0].numpy()
        np.save(os.path.join(out, f"{t['cohort']}~{t['id']}.npy"), P.astype(np.float16))
        p = S.viterbi(P, logT, logPrior); h = t['n'] // 2; ys = np.roll(t['y'], -h)
        rows.append(dict(cohort=t['cohort'], conf=S.confusion(t['y'], p).tolist(), shift=S.confusion(ys, p).tolist()))
        if i % 200 == 0: print(f'{i}/{len(test)} {time.time()-t0:.0f}s', flush=True)
json.dump(dict(job='seqnet-port-bs1-fold-0', model='seqnet-port-bs1', innerValKappa=meta['inner_val_kappa'], out=rows), open(os.path.join(cache, 'bench-port', 'seqnet-port-bs1-fold-0.json'), 'w'))
M = sum(np.array(r['conf']) for r in rows); print('bs1 pooled kappa', round(S.kappa(M), 4), 'nights', len(rows), f'{time.time()-t0:.0f}s')
