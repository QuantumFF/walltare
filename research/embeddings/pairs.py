import json, numpy as np, imagehash, itertools
d=json.load(open('data.json'))
R={r[0]:r for r in d['rows']}
def P(src):
    ids=d[src]['ids']; ph=[imagehash.hex_to_hash(h) for h in d[src]['ph']]; E=np.array(d[src]['E']); C=E@E.T
    res={}
    for a,b in itertools.combinations(range(len(ids)),2):
        res[(ids[a],ids[b])]=(ph[a]-ph[b], float(C[a,b]))
    return res
s=P('small'); o=P('source')
sel=[k for k,(h,c) in s.items() if h<=22 or c>=0.85]
top=sorted(s,key=lambda k:-s[k][1])[:15]
sel=sorted(set(sel)|set(top), key=lambda k:-s[k][1])
print('pairs',len(s))
for k in sel:
    h,c=s[k]; h2,c2=o[k]
    print(f"{k[0]:>4} {k[1]:>4}  ham={h:2d} cos={c:.3f} | src ham={h2:2d} cos={c2:.3f}  {R[k[0]][1].split('/')[-1]} {R[k[0]][3]}x{R[k[0]][4]} | {R[k[1]][1].split('/')[-1]} {R[k[1]][3]}x{R[k[1]][4]}")
# also: selections by source
print('source-only hits:', [ (k,o[k]) for k in o if (o[k][0]<=22 or o[k][1]>=0.85) and k not in sel])
hs=sorted(h for h,c in s.values()); print('min hams', hs[:12])
cs=np.array([c for h,c in s.values()]); print('cos pctl', np.percentile(cs,[50,90,99,99.9]).round(3))
json.dump([list(k) for k in sel],open('sel.json','w'))
A=np.array(d['small']['A']); A2=np.array(d['source']['A'])
print('aes small', np.percentile(A,[0,10,25,50,75,90,100]).round(2), A.mean().round(2), A.std().round(2))
print('aes source', np.percentile(A2,[0,10,25,50,75,90,100]).round(2), A2.mean().round(2), A2.std().round(2), 'corr', np.corrcoef(A,A2)[0,1].round(3))
ids=d['small']['ids']; o_=np.argsort(A); print('lowest', [(ids[i],round(A[i],2)) for i in o_[:5]], 'highest', [(ids[i],round(A[i],2)) for i in o_[-5:]])
print('hist', np.histogram(A,bins=np.arange(3,8.5,0.5)))
