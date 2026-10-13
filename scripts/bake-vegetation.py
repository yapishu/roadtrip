#!/usr/bin/env python3
"""Place regional vegetation over aerial canopy texture beside mapped roads.

Canopy positions are inferred from aerial color and local texture; individual
species and heights are representative. Explicit OSM trees keep their positions.
"""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter,map_coordinates
from scipy.spatial import cKDTree
from shapely.geometry import Polygon
from shapely import contains_xy

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--trip',type=Path,required=True);ap.add_argument('--chunks');a=ap.parse_args();root=a.trip/'world';paths=[root/f'c{int(c):04d}.json'for c in a.chunks.split(',')]if a.chunks else sorted(root.glob('c[0-9][0-9][0-9][0-9].json'))
    for path in paths:
        d=json.loads(path.read_text());g=d['near'];rgb=np.asarray(Image.open(root/g['image']).convert('RGB'),dtype='float32')/255;r,green,b=rgb.transpose(2,0,1);gray=(r+green+b)/3;variation=np.sqrt(np.maximum(0,uniform_filter(gray**2,size=5)-uniform_filter(gray,size=5)**2));canopy=(green>r*1.045)&(green>b*1.08)&(gray<.64)&(variation>.026)
        step=8.;xs=np.arange(g['x0']+4,g['x0']+(g['w']-1)*g['cell'],step);ys=np.arange(g['y0']+4,g['y0']+(g['h']-1)*g['cell'],step);xx,yy=np.meshgrid(xs,ys);x=xx.ravel();y=yy.ravel();rng=np.random.default_rng(d['c']+74281);x+=rng.uniform(-2.7,2.7,len(x));y+=rng.uniform(-2.7,2.7,len(y));u=(x-g['x0'])/((g['w']-1)*g['cell'])*(rgb.shape[1]-1);v=(1-(y-g['y0'])/((g['h']-1)*g['cell']))*(rgb.shape[0]-1);good=map_coordinates(canopy.astype('float32'),[v,u],order=0,mode='nearest')>.5;x=x[good];y=y[good]
        route=np.array(d['route']);dist,_=cKDTree(route[:,1:3]).query(np.c_[x,y]);good=dist<220;x=x[good];y=y[good]
        roadpoints=[];radii=[]
        for road in d['roads']:
            for p in road['points']:roadpoints.append(p[:2]);radii.append(road['width']/2+2.5)
        if roadpoints and len(x):
            dist,nearest=cKDTree(roadpoints).query(np.c_[x,y]);good=dist>np.asarray(radii)[nearest];x=x[good];y=y[good]
        good=np.ones(len(x),dtype=bool)
        for building in d['buildings']:
            p=np.asarray(building['points']);near=(x>p[:,0].min()-2)&(x<p[:,0].max()+2)&(y>p[:,1].min()-2)&(y<p[:,1].max()+2)
            if near.any():good[near]&=~contains_xy(Polygon(p,building.get('holes')).buffer(1.5),x[near],y[near])
        x=x[good];y=y[good];dem=np.fromfile(root/g['file'],'<u2').reshape(g['h'],g['w'])*g['scale']+g['offset'];z=map_coordinates(dem,[(y-g['y0'])/g['cell'],(x-g['x0'])/g['cell']],order=1,mode='nearest');trees=[]
        for i,(px,py,pz)in enumerate(zip(x,y,z)):
            trees.append([round(float(px),2),round(float(py),2),round(float(pz),2),round(float(rng.uniform(.75,1.25)),3),int(rng.integers(0,65536))])
        for t in d['trees']:trees.append([t[0],t[1],t[2],1,int(rng.integers(0,65536))])
        target=root/('v'+path.stem[1:]+'.json');tmp=target.with_suffix('.tmp');tmp.write_text(json.dumps(dict(trees=trees,source='Aerial canopy inference and OpenStreetMap tree points',species='Representative regional vegetation'),separators=(',',':')));tmp.replace(target);print(f'{path.stem}: {len(trees)} canopy placements',flush=True)
if __name__=='__main__':main()
