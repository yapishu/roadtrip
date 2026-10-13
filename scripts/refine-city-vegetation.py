#!/usr/bin/env python3
"""Refine urban planting from one-metre USGS aerial imagery beside occupied streets."""
import argparse,concurrent.futures,hashlib,importlib.util,json,math,threading
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.spatial import cKDTree
from urban_vegetation import city_route,crowns,planting_exclusions,clear_positions

spec=importlib.util.spec_from_file_location('world',Path(__file__).with_name('bake-world.py'));world=importlib.util.module_from_spec(spec);spec.loader.exec_module(world)
TILE=2048
TILE_LOCKS={}
PIPELINE=hashlib.sha256(Path(__file__).read_bytes()+Path(__file__).with_name('urban_vegetation.py').read_bytes()).digest()

def process(path,cache,resume=False):
    encoded=path.read_bytes();digest=hashlib.sha256(encoded+PIPELINE).hexdigest();data=json.loads(encoded);target=path.with_name('v'+path.name[1:]);vegetation=json.loads(target.read_text())
    if resume and vegetation.get('urban',{}).get('inputDigest')==digest:
        plants=vegetation['plants'];return dict(file=str(path),plants=len(plants),trees=sum(p['kind']=='tree'for p in plants),shrubs=sum(p['kind']=='shrub'for p in plants),tiles=len(vegetation['urban']['tiles']),changed=True,reused=True)
    centers=city_route(data)
    if not len(centers):return dict(file=str(path),plants=0,tiles=0,changed=False)
    origin=np.asarray(data['origin']);centers_global=centers+origin;tree=cKDTree(centers);tiles=set()
    for x,y in centers_global:
        for ix in range(math.floor((x-170)/TILE),math.floor((x+170)/TILE)+1):
            for iy in range(math.floor((y-170)/TILE),math.floor((y+170)/TILE)+1):tiles.add((ix,iy))
    exclusions=planting_exclusions(data);plants=[];sources=[]
    for ix,iy in sorted(tiles):
        x0,y0=ix*TILE,iy*TILE;file=cache/f'{TILE}-{ix}_{iy}.jpg';params=dict(bbox=f'{x0},{y0},{x0+TILE},{y0+TILE}',bboxSR=5070,imageSR=5070,size=f'{TILE},{TILE}',f='image',format='jpg',bandIds='0,1,2',interpolation='RSP_BilinearInterpolation',compressionQuality=95)
        with TILE_LOCKS.setdefault((ix,iy),threading.Lock()):world.fetch(world.NAIP,params,file)
        image=Image.open(file).convert('RGB')
        if image.size!=(TILE,TILE):raise ValueError(f'Wrong aerial dimensions: {file}')
        corridor=Image.new('1',(TILE,TILE));draw=ImageDraw.Draw(corridor)
        for cx,cy in centers_global:
            px,py=cx-x0,y0+TILE-cy
            if -175<px<TILE+175 and -175<py<TILE+175:draw.ellipse((px-175,py-175,px+175,py+175),fill=1)
        candidates=crowns(image,np.asarray(corridor,dtype=bool))
        if not candidates:continue
        xy=np.array([[x0+x+.5-origin[0],y0+TILE-y-.5-origin[1]] for x,y,_ in candidates]);distance,_=tree.query(xy);valid=(distance<165)&clear_positions(exclusions,xy)
        for (x,y,radius),point,keep in zip(candidates,xy,valid):
            if not keep:continue
            seed=int.from_bytes(hashlib.blake2s(f'{x0+x}:{y0+TILE-y}'.encode(),digest_size=4).digest(),'little');small=radius<1.9
            width=round(np.clip(radius*1.85,2.3,10.5),2);height=round((.8+radius*.35) if small else np.clip(4.3+radius*.95,5.6,11),2)
            plants.append(dict(x=round(float(point[0]),2),y=round(float(point[1]),2),width=width,height=height,kind='shrub' if small else 'tree',seed=seed))
        sources.append(dict(tile=[ix,iy],bbox=[x0,y0,x0+TILE,y0+TILE],metresPerPixel=1))
    base=vegetation['trees']
    # Replace the coarse inference only inside the refined, measured corridor.
    if base:
        distance,_=tree.query(np.asarray(base)[:,:2]);base=[p for p,dist in zip(base,distance) if dist>=165]
    vegetation.update(trees=base,plants=plants,urban=dict(source='USGS NAIP metre-scale aerial crown inference',speciesAndHeights='Representative urban trees and shrubs',inputDigest=digest,tiles=sources))
    temporary=target.with_suffix('.plants.tmp');temporary.write_text(json.dumps(vegetation,separators=(',',':')));temporary.replace(target)
    result=dict(file=str(path),plants=len(plants),trees=sum(p['kind']=='tree' for p in plants),shrubs=sum(p['kind']=='shrub' for p in plants),tiles=len(tiles),changed=True);print(json.dumps(result),flush=True);return result

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--trip',required=True,type=Path);ap.add_argument('--chunks');ap.add_argument('--workers',type=int,default=2);ap.add_argument('--resume',action='store_true');ap.add_argument('--output',type=Path,required=True);a=ap.parse_args();cache=a.trip/'.cache/urban-vegetation';cache.mkdir(parents=True,exist_ok=True)
    paths=[a.trip/'world'/f'c{int(c):04d}.json' for c in a.chunks.split(',')] if a.chunks else sorted((a.trip/'world').glob('c????.json'))+sorted((a.trip/'parks').glob('*/world/c????.json'))+sorted((a.trip/'detours').glob('*/world/c????.json'))
    results=[];errors=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers)as pool:
        futures={pool.submit(process,p,cache,a.resume):p for p in paths}
        for future in concurrent.futures.as_completed(futures):
            try:results.append(future.result())
            except Exception as error:
                item=dict(file=str(futures[future]),error=str(error));errors.append(item);print('FAILED',json.dumps(item),flush=True)
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(dict(sections=results,errors=errors,source='USGS NAIP aerial imagery',inference='Crown positions and sizes from color and texture; species and height are representative'),indent=2))
    if errors:raise SystemExit(1)
if __name__=='__main__':main()
