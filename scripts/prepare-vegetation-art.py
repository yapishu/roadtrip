#!/usr/bin/env python3
"""Mask generated regional plants, reject clipped subjects and retain review evidence."""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import label
from rembg import remove,new_session
ap=argparse.ArgumentParser();ap.add_argument('--trip',type=Path,required=True);a=ap.parse_args();art=a.trip/'regional/art';out=art/'plants';out.mkdir(exist_ok=True);plan=json.loads((art/'plan.json').read_text());drops=set((art/'drop.txt').read_text().split())if(art/'drop.txt').exists()else set();session=new_session('u2net');report={}
for job in plan['jobs']:
 if job['kind']!='sprite':continue
 path=art/'raw'/(job['name']+'.png')
 if not path.exists():continue
 raw=Image.open(path).convert('RGB')
 if job.get('baseTrim'):raw=raw.crop((0,0,raw.width,round(raw.height*(1-job['baseTrim']))))
 if job.get('background')=='magenta':
  rgba=np.array(raw.convert('RGBA'));r,g,b=rgba[:,:,:3].astype('float32').transpose(2,0,1);rgba[:,:,3]=((r<g*1.4)|(b<g*1.3)|(r<80)|(b<70)).astype('uint8')*255
 else:rgba=np.array(remove(raw,session=session).convert('RGBA'))
 mask=rgba[:,:,3]>145;components,n=label(mask);counts=np.bincount(components.ravel());counts[0]=0;largest=counts.max();mask&=counts[components]>max(4,largest*.008)
 flags=[]
 if mask.sum()<120:flags.append('empty')
 if mask[:2].sum()>2 or mask[:,:2].sum()>2 or mask[:,-2:].sum()>2:flags.append('clipped')
 if job['name']in drops:flags.append('reviewed-exclusion')
 rgba[:,:,3]=mask.astype('uint8')*255;im=Image.fromarray(rgba);box=im.getbbox()
 if box:im=im.crop(box)
 im.save(out/(job['name']+'.png'));report[job['name']]=dict(drop=bool(flags),flags=flags,size=list(im.size));print(job['name'],flags or 'ready',flush=True)
(art/'plants.json').write_text(json.dumps(report,separators=(',',':')))
