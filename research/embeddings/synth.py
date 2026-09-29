import json, os, io, numpy as np, torch, open_clip, imagehash, random
from PIL import Image, ImageOps, ImageEnhance
Image.MAX_IMAGE_PIXELS=None
d=json.load(open('data.json')); rows={r[0]:r for r in d['rows']}
ids=d['small']['ids']; E=np.array(d['small']['E']); ph=[imagehash.hex_to_hash(h) for h in d['small']['ph']]
model,_,pre=open_clip.create_model_and_transforms('ViT-B-32',pretrained='openai',device='cuda'); model.eval()
def small(im): im=im.copy(); im.thumbnail((400,10000)); b=io.BytesIO(); im.save(b,'JPEG',quality=85); return Image.open(b).convert('RGB')
def crop(im,f,ax=None):
    w,h=im.size; cw,ch=int(w*f),int(h*f); return im.crop(((w-cw)//2,(h-ch)//2,(w-cw)//2+cw,(h-ch)//2+ch))
def cropoff(im,f):  # off-centre crop keeping left-top
    w,h=im.size; return im.crop((0,0,int(w*f),int(h*f)))
def wide(im):  # 16:9 -> 21:9 band
    w,h=im.size; nh=int(w*9/21); return im.crop((0,(h-nh)//2,w,(h-nh)//2+nh))
def jpg(im,q):
    b=io.BytesIO(); im.save(b,'JPEG',quality=q); return Image.open(b).convert('RGB')
V={'reencode_q60_1920':lambda im: jpg(im.resize((1920,int(1920*im.height/im.width))),60),
   'crop_centre_90':lambda im: crop(im,0.9),'crop_centre_75':lambda im: crop(im,0.75),'crop_centre_50':lambda im: crop(im,0.5),
   'crop_corner_70':lambda im: cropoff(im,0.7),'crop_to_21x9':wide,
   'bright+contrast':lambda im: ImageEnhance.Contrast(ImageEnhance.Brightness(im).enhance(1.25)).enhance(1.3),
   'saturation_0.4':lambda im: ImageEnhance.Color(im).enhance(0.4),'grayscale':lambda im: ImageOps.grayscale(im).convert('RGB'),
   'hue_shift':lambda im: Image.merge('RGB',im.split()[::-1]),'hflip':ImageOps.mirror}
random.seed(1); pick=random.sample(range(len(ids)),30)
res={k:[] for k in V}
for n in pick:
    i=ids[n]; src=Image.open(rows[i][1]).convert('RGB'); src.thumbnail((3840,3840))
    for k,f in V.items():
        v=small(f(src)); h=imagehash.phash(v)
        with torch.no_grad():
            e=model.encode_image(pre(v)[None].cuda()).float(); e=(e/e.norm()).cpu().numpy()[0]
        cos=E@e; others=[j for j in range(len(ids)) if j!=n]
        res[k].append((int(h-ph[n]), float(cos[n]), int(min(h-ph[j] for j in others)), float(max(cos[j] for j in others))))
json.dump(res,open("synth.json","w"))
print(f"{'variant':20s} ham(min/med/max)  cos(min/med/max)   nearest-other: ham_min cos_max")
for k,r in res.items():
    a=np.array(r); print(f"{k:20s} {int(a[:,0].min()):2d}/{np.median(a[:,0]):4.1f}/{int(a[:,0].max()):2d}   {a[:,1].min():.3f}/{np.median(a[:,1]):.3f}/{a[:,1].max():.3f}   {int(a[:,2].min()):2d} {a[:,3].max():.3f}")
