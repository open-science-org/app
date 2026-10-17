"""Turns the Lean problem set's reference DAG into a world file for the simulator.

    python3 sim/worlds/from-reference-dag.py problems/reference-dag.md sim/worlds/lean-reference.json

Theorem names are replaced by anonymous ids (area letter and number), so the file shows the shape of
the reference tree without the lemma statements. Posted targets keep their public ids (A3, B5, ...)
and get bounty 4 · 2^(depth − 1). B3 is a pair of theorems; its bounty goes to the deeper one.
Success chances are left to the scenario's success model, by level.
"""
import json
import sys

src, out = sys.argv[1], sys.argv[2]
rows = []
for line in open(src):
    if not line.startswith('| ') or line.startswith('| Depth') or line.startswith('| ---'):
        continue
    depth, name, area, posted, uses = [c.strip() for c in line.strip().strip('|').split('|')]
    rows.append({
        'depth': int(depth), 'name': name.strip('`'), 'area': area, 'posted': posted,
        'uses': [u.strip().strip('`') for u in uses.split(',') if u.strip() not in ('', '—')],
    })

# B3 is posted on two theorems; keep it on the deeper one only.
for p in {r['posted'] for r in rows if r['posted']}:
    group = [r for r in rows if r['posted'] == p]
    for r in sorted(group, key=lambda r: r['depth'])[:-1]:
        r['posted'] = ''

area_index = {'A': 0, 'B': 1, 'C': 2, 'cross': 3}
letter = {'A': 'A', 'B': 'B', 'C': 'C', 'cross': 'X'}
rows.sort(key=lambda r: (r['depth'], r['area'], r['name']))
ids, counts = {}, {}
for r in rows:
    if r['posted']:
        ids[r['name']] = r['posted']
    else:
        counts[r['area']] = counts.get(r['area'], 0) + 1
        ids[r['name']] = f"{letter[r['area']]}-{counts[r['area']]:02d}"
nodes = []
for r in rows:
    node = {'id': ids[r['name']], 'area': area_index[r['area']]}
    if r['uses']:
        node['prereqs'] = [ids[u] for u in r['uses']]
    if r['posted']:
        node['bounty'] = 4 * 2 ** (r['depth'] - 1)
    nodes.append(node)
json.dump({'source': 'Lean problem set reference DAG (anonymized)', 'nodes': nodes}, open(out, 'w'), indent=1)
print(f"{len(nodes)} results, {sum('bounty' in n for n in nodes)} targets -> {out}")
