# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
import glob, collections
o2, real = [], []
for f in sorted(glob.glob("/srv/tepna/captures/2026-*/*_PMDARRIVAL.csv")):
    try: L = open(f).read().split("\n")
    except Exception: continue
    if len(L) < 200: continue
    per = collections.defaultdict(list)
    for ln in L[1:]:
        c = ln.split(";")
        if len(c) < 4: continue
        try: per[c[2]].append(int(c[3]))
        except Exception: pass
    for meas, v in per.items():
        if len(v) < 200: continue
        d = [v[i]-v[i-1] for i in range(1, len(v))]
        t = collections.Counter(d)
        sh = t.most_common(1)[0][1]/len(d)*100
        drawn = ("O2Ring" in f) or (meas == "ppi")
        (o2 if drawn else real).append((sh, f.split("/")[-1][:44], meas))
o2.sort(); real.sort(reverse=True)
print("DRAWN streams (O2Ring duration counter + Verity PPI):", len(o2), "files")
print("  lowest shares:", ", ".join(f"{s:.2f}%" for s, _, _ in o2[:6]))
print("REAL clock streams:", len(real), "files")
print("  highest shares:", ", ".join(f"{s:.2f}%" for s, _, _ in real[:6]))
print()
for thr in (99, 95, 90, 80, 67, 60):
    miss = sum(1 for s, _, _ in o2 if s < thr)
    fp   = sum(1 for s, _, _ in real if s >= thr)
    print(f"  threshold {thr:3d}%  -> drawn MISSED {miss:3d}/{len(o2)}   false-positives on real {fp:3d}/{len(real)}")
