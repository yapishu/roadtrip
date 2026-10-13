#!/usr/bin/env python3
"""Rectify visible mapped building walls from geotagged route imagery.

A depth agreement check rejects occluded or mismatched walls. Each accepted face
keeps the source panorama, date and attribution. Unobserved faces stay untextured.
"""
import argparse,json,math
from pathlib import Path
from functools import lru_cache
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree
from pyproj import Transformer
PROJECT=Transformer.from_crs(4326,5070,always_xy=True)
UNPROJECT=Transformer.from_crs(5070,4326,always_xy=True)

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--trip',type=Path,required=True);ap.add_argument('--chunks');a=ap.parse_args();trip=a.trip.resolve();cache=trip/'.cache/streetview';out=trip/'world';photos=[]
    for path in (cache/'metadata').glob('*.json'):
        m=json.loads(path.read_text())
        if m.get('depth') and (cache/m['image']).exists():
            m['xy']=PROJECT.transform(m['lon'],m['lat']);photos.append(m)
    if not photos:raise SystemExit('No depth-backed panorama references')
    tree=cKDTree([p['xy'] for p in photos])
    @lru_cache(maxsize=32)
    def pixels(i):return np.asarray(Image.open(cache/photos[i]['image']).convert('RGB')),np.load(cache/photos[i]['depth'])['depth']
    def project(x,y,z,m):
        lon,lat=UNPROJECT.transform(x,y);east=(lon-m['lon'])*111320*math.cos(math.radians(m['lat']));north=(lat-m['lat'])*111320
        flat=np.hypot(east,north);vertical=z-m['elevation'];distance=np.hypot(flat,vertical)
        yaw=np.arctan2(east,north)-m['heading'];u=(yaw/(2*np.pi)+.5)%1;v=.5-np.arctan2(vertical,flat)/np.pi
        return u,v,distance
    def rectify(b,p,q,d):
        midpoint=(p+q)/2+d['origin'];distance,ids=tree.query(midpoint,k=min(10,len(photos)),distance_upper_bound=95)
        length=np.linalg.norm(q-p)
        if length<2:return None
        best=None
        for dist,j in zip(np.atleast_1d(distance),np.atleast_1d(ids)):
            if not np.isfinite(dist):continue
            m=dict(photos[j]);image,depth=pixels(int(j));cx,cy=m['xy'];m['elevation']=float(map_coordinates(current_dem,[[(cy-d['origin'][1]-current_grid['y0'])/current_grid['cell']],[(cx-d['origin'][0]-current_grid['x0'])/current_grid['cell']]],order=1,mode='nearest')[0])+float(np.clip(np.median(depth[180:220]*np.sin(((np.arange(180,220)[:,None]+.5)/256-.5)*np.pi)),1.8,3.3));camera=np.array(m['xy'])-d['origin'];edge=q-p
            # Outward-facing side of a counterclockwise footprint.
            delta=camera-p;side=edge[0]*delta[1]-edge[1]*delta[0]
            if side*b['_sign']>0:continue
            incidence=abs(float(side))/(length*max(dist,1))
            if incidence<.35:continue
            xx,zz=np.meshgrid(np.linspace(.05,.95,10),np.linspace(.1,.9,6));positions=p[None,None,:]+(q-p)[None,None,:]*xx[:,:,None]+np.array(d['origin']);z=b['base']+b['height']*(1-zz)
            u,v,expected=project(positions[:,:,0],positions[:,:,1],z,m);image,depth=pixels(int(j));observed=map_coordinates(depth,[v*(depth.shape[0]-1),u*(depth.shape[1]-1)],order=0,mode='wrap');valid=(observed>0)&(abs(observed-expected)<np.maximum(5,expected*.22));agreement=float(valid.mean())
            if agreement<.6:continue
            score=agreement*incidence/max(8,dist)
            if best is None or score>best[0]:best=(score,int(j),agreement,m)
        if best is None:return None
        _,j,agreement,m=best;image,_=pixels(j);w=min(256,max(16,round(length*5)));h=min(128,max(16,round(b['height']*5)))
        xx,zz=np.meshgrid(np.linspace(0,1,w),np.linspace(0,1,h));positions=p[None,None,:]+(q-p)[None,None,:]*xx[:,:,None]+np.array(d['origin']);z=b['base']+b['height']*(1-zz)
        u,v,_=project(positions[:,:,0],positions[:,:,1],z,m)
        rgb=np.stack([map_coordinates(image[:,:,c],[v*(image.shape[0]-1),u*(image.shape[1]-1)],order=1,mode='wrap')for c in range(3)],axis=2)
        return Image.fromarray(rgb),dict(pano=m['id'],date=m['date'],attribution=m['attribution'],url=m['url'],agreement=round(agreement,2))
    paths=[out/f'c{int(c):04d}.json'for c in a.chunks.split(',')]if a.chunks else sorted(out.glob('c[0-9][0-9][0-9][0-9].json'))
    for path in paths:
        d=json.loads(path.read_text());current_grid=d['near'];current_dem=np.fromfile(out/current_grid['file'],'<u2').reshape(current_grid['h'],current_grid['w'])*current_grid['scale']+current_grid['offset'];faces=[];atlases=[];atlas=Image.new('RGB',(2048,2048));ax=ay=row=0;page=0
        for b in d['buildings']:
            p=np.array(b['points']);b['_sign']=np.sign(np.sum(p[:-1,0]*p[1:,1]-p[1:,0]*p[:-1,1]))
            for k,(v,w)in enumerate(zip(p[:-1],p[1:])):
                result=rectify(b,v,w,d)
                if result is None:continue
                tile,source=result;tw,th=tile.size
                if ax+tw>2048:ax=0;ay+=row+2;row=0
                if ay+th>2048:
                    name=path.stem+f'-walls-{page}.jpg';atlas.save(out/name,quality=90);atlases.append(name);page+=1;atlas=Image.new('RGB',(2048,2048));ax=ay=row=0
                atlas.paste(tile,(ax,ay));faces.append(dict(building=b['id'],edge=k,page=page,rect=[ax,ay,tw,th],source=source));ax+=tw+2;row=max(row,th)
        if faces:
            name=path.stem+f'-walls-{page}.jpg';atlas.save(out/name,quality=90);atlases.append(name)
        result=dict(atlases=atlases,size=2048,faces=faces,references=len(photos));target=out/('a'+path.stem[1:]+'.json');temp=target.with_suffix('.tmp');temp.write_text(json.dumps(result,separators=(',',':')));temp.replace(target)
        print(f'{path.stem}: {len(faces)} observed walls in {len(atlases)} atlases',flush=True)
if __name__=='__main__':main()
