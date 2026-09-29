import sqlite3, os, numpy as np, torch, open_clip, imagehash, json
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
H=os.path.expanduser('~/.local/share/com.quantumff.walltare')
db=sqlite3.connect(f'file:{H}/walltare.db?mode=ro',uri=True)
rows=db.execute('select id,path,status,width,height,wallhaven_id from wallpapers order by id').fetchall()
model,_,pre=open_clip.create_model_and_transforms('ViT-B-32',pretrained='openai',device='cuda'); model.eval()
head=torch.nn.Linear(512,1); head.load_state_dict(torch.load('sa_0_4_vit_b_32_linear.pth')); head=head.cuda()
def emb(imgs):
    with torch.no_grad():
        x=torch.stack([pre(i) for i in imgs]).cuda(); e=model.encode_image(x).float(); e=e/e.norm(dim=-1,keepdim=True)
        return e
out={}
for src in ['small','source']:
    ids=[];ph=[];E=[];A=[]
    for (i,p,st,w,h,wh) in rows:
        f=f'{H}/thumbnails/{i}_small.jpg' if src=='small' else p
        if not os.path.exists(f): print('missing',src,i,f); continue
        im=Image.open(f).convert('RGB')
        ids.append(i); ph.append(imagehash.phash(im))
        e=emb([im]); E.append(e.cpu().numpy()[0]); A.append(head(e).item())
    E=np.array(E); out[src]=dict(ids=ids,ph=[str(x) for x in ph],E=E.tolist(),A=A)
    print(src,len(ids))
json.dump(dict(rows=rows,**out),open('data.json','w'))
