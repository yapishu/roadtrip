#!/usr/bin/env python3
"""Resolve steep road-cut artifacts with targeted two-metre USGS terrain grids."""
import argparse,concurrent.futures,importlib.util,json,math
from pathlib import Path
import numpy as np
from scipy.ndimage import map_coordinates
ROOT=Path(__file__).resolve().parent
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
world=module('world','bake-world.py');profiles=module('profiles','refine-road-profiles.py')
def process(path):
 d=json.loads(path.read_text())
 if d.get('roadDetail'):return
 if not d.get('roadProfile'):d=profiles.refine(d)
 route=d['route'];ss=np.array([p[0]for p in route]);z=np.array([p[3]for p in route]);ps=np.arange(ss[0],ss[-1],5);grades=np.abs(np.diff(np.interp(ps,ss,z))/5);bad=ps[:-1][grades>.20];intervals=[]
 for s in bad:
  if intervals and s-intervals[-1][1]<160:intervals[-1][1]=s+160
  else:intervals.append([s-160,s+160])
 if not intervals:return
 coords=np.array([p[1:3]for p in route]);origin=np.array(d['origin']);boxes=[]
 for start,end in intervals:
  p=coords[(ss>=start)&(ss<=end)]+origin
  if len(p)<2:continue
  lo=np.floor((p.min(axis=0)-100)/10)*10;hi=np.ceil((p.max(axis=0)+100)/10)*10;boxes.append([lo,hi])
 changed=True
 while changed:
  changed=False
  for i in range(len(boxes)):
   for j in range(i+1,len(boxes)):
    if np.all(boxes[i][1]>=boxes[j][0])and np.all(boxes[j][1]>=boxes[i][0]):
     boxes[i]=[np.minimum(boxes[i][0],boxes[j][0]),np.maximum(boxes[i][1],boxes[j][1])];boxes.pop(j);changed=True;break
   if changed:break
 out=path.parent;trip=out.parent;cache=trip/'.cache/world';cache.mkdir(parents=True,exist_ok=True);details=[]
 near=d['near'];coarse=np.fromfile(out/near['file'],'<u2').reshape(near['h'],near['w'])*.1-500
 for i,(lo,hi)in enumerate(boxes):
  g=dict(x0=float(lo[0]),y0=float(lo[1]),w=int((hi[0]-lo[0])/2)+1,h=int((hi[1]-lo[1])/2)+1,cell=2)
  if g['w']*g['h']>2000000:raise ValueError('Detail grid too large: '+str(path))
  dem=world.near_dem(g,cache/f'{path.stem}-detail-{i}.tif')
  for r in d['roads']:
   p=np.array(r['points']);xy=p[:,:2]+origin;inside=np.all(xy>=lo,axis=1)&np.all(xy<=hi,axis=1)
   if inside.any():
    p[inside,2]=world.sample(g,dem,xy[inside])+.12;r['points']=np.round(p,2).tolist()
  # Match the surrounding ten-metre mesh at the patch perimeter.
  xx,yy=np.meshgrid(np.arange(g['w'])*2+lo[0]-origin[0],np.arange(g['h'])*2+lo[1]-origin[1]);coarse_h=map_coordinates(coarse,[(yy-near['y0'])/near['cell'],(xx-near['x0'])/near['cell']],order=1,mode='nearest');edge=np.minimum(np.minimum(np.arange(g['w'])[None,:],g['w']-1-np.arange(g['w'])[None,:]),np.minimum(np.arange(g['h'])[:,None],g['h']-1-np.arange(g['h'])[:,None]));blend=np.clip(edge/10,0,1);dem=dem*blend+coarse_h*(1-blend)
  file=f'{path.stem}-detail-{i}.bin';np.round((dem+500)*10).astype('<u2').tofile(out/file);g.update(x0=float(lo[0]-origin[0]),y0=float(lo[1]-origin[1]),file=file,scale=.1,offset=-500,min=round(float(dem.min()),1),max=round(float(dem.max()),1),image=near['image'],textureBounds=near);details.append(g)
 d=profiles.refine(d);d['details']=details;d['roadDetail']='USGS best-available elevation sampled at two metres around road cuts';tmp=path.with_suffix('.detail.tmp');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(path);print(str(path),len(details),'two-metre terrain patches',flush=True)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--trip',type=Path,required=True);ap.add_argument('--workers',type=int,default=6);a=ap.parse_args();paths=list((a.trip/'world').glob('c[0-9][0-9][0-9][0-9].json'))+list((a.trip/'parks').glob('*/world/c[0-9][0-9][0-9][0-9].json'));errors=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers)as pool:
  work={pool.submit(process,p):p for p in paths}
  for f in concurrent.futures.as_completed(work):
   try:f.result()
   except Exception as e:errors.append([str(work[f]),str(e)]);print('FAILED',work[f],str(e),flush=True)
 print('Road-cut refinement complete;',len(errors),'failures',flush=True)
 if errors:raise SystemExit(1)
if __name__=='__main__':main()
