"""Fill the `split` column: equal thirds, grouped so nothing leaks, label-balanced.

A paper and the reference papers it is labeled against all land in one split, and so does every
other paper that shares one of those references (otherwise a reference the optimizer saw in
training would reappear in test).

usage: python split_dataset.py labels.csv   # the Labeler page's "Download labels CSV"
"""
import sys

import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

path = sys.argv[1]
df = pd.read_csv(path)
df = df.drop(columns=["split"], errors="ignore")

# Papers and references that touch are one group (union-find over paper_id / reference_id).
parent: dict[str, str] = {}


def find(x: str) -> str:
    parent.setdefault(x, x)
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


for paper, ref in zip(df.paper_id, df.get("reference_id", df.paper_id), strict=True):
    parent[find(f"paper:{paper}")] = find(f"paper:{ref}")
groups = df.paper_id.map(lambda p: find(f"paper:{p}"))

df["split"] = ""
folds = StratifiedGroupKFold(n_splits=3, shuffle=True, random_state=0)
for name, (_, idx) in zip(["train", "val", "test"], folds.split(df, df.evidence, groups), strict=True):
    df.loc[df.index[idx], "split"] = name

assert (df.groupby(groups).split.nunique() == 1).all(), "a paper group is in more than one split"
df.to_csv(path, index=False)
print(pd.crosstab(df.split, df.evidence, margins=True))
