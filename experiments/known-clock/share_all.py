# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
import glob, collections
rows = []
for f in sorted(glob.glob("/srv/tepna/captures/2026-*/*_PMDARRIVAL.csv")):
    try:
        L = open(f).read().split("\n")
    except Exception:
        continue
    if len(L) < 200:
        continue
    per = collections.defaultdict(list)
    for ln in L[1:]:
        c = ln.split(";")
        if len(c) < 4:
            continue
        try:
            per[c[2]].append(int(c[3]))
        except Exception:
            pass
    for meas, v in per.items():
        if len(v) < 200:
            continue
        d = [v[i] - v[i-1] for i in range(1, len(v))]
        t = collections.Counter(d)
        share = t.most_common(1)[0][1] / len(d) * 100
        dev = "O2Ring" if "O2Ring" in f else ("H10" if "H10" in f else "Verity")
        rows.append((dev, meas, len(t), share))
agg = collections.defaultdict(list)
for dev, meas, dis, sh in rows:
    agg[(dev, meas)].append(sh)
hdr = "device/meas".ljust(20) + "files".rjust(6) + "min%".rjust(9) + "median%".rjust(9) + "max%".rjust(9)
print(hdr)
print("-" * len(hdr))
for k in sorted(agg):
    s = sorted(agg[k])
    med = s[len(s)//2]
    print((k[0] + "/" + k[1]).ljust(20) + str(len(s)).rjust(6) + f"{s[0]:9.2f}{med:9.2f}{s[-1]:9.2f}")
