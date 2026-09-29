import json, numpy as np, imagehash, itertools, os
from PIL import Image, ImageDraw, ImageFont
d=json.load(open('data.json')); H=os.path.expanduser('~/.local/share/com.quantumff.walltare/thumbnails')
ids=d['small']['ids']; ph=[imagehash.hex_to_hash(h) for h in d['small']['ph']]; E=np.array(d['small']['E']); C=E@E.T
P={(ids[a],ids[b]):(ph[a]-ph[b],float(C[a,b])) for a,b in itertools.combinations(range(len(ids)),2)}
A=[k for k in P if P[k][1]>=0.85]; B=[k for k in P if P[k][0]<22]
print(len(A),len(B), 'overlap', len(set(A)&set(B)))
sel=sorted(set(A),key=lambda k:-P[k][1])+sorted(set(B)-set(A),key=lambda k:(P[k][0],-P[k][1]))
W,Hh=300,170; cols=3; cw=2*W+20; ch=Hh+28
font=ImageFont.load_default(size=16)
rows=(len(sel)+cols-1)//cols
sheet=Image.new('RGB',(cols*cw,rows*ch),'white'); dr=ImageDraw.Draw(sheet)
for n,k in enumerate(sel):
    x=(n%cols)*cw; y=(n//cols)*ch
    for j,i in enumerate(k):
        im=Image.open(f'{H}/{i}_small.jpg').convert('RGB'); im.thumbnail((W-6,Hh))
        sheet.paste(im,(x+j*W,y+24))
    h,c=P[k]; dr.text((x+4,y+3),f"#{n+1}  {k[0]} vs {k[1]}   ham={h}  cos={c:.3f}",fill='red' if c>=0.85 else 'blue',font=font)
sheet.save('pairs.png'); print(sheet.size)
