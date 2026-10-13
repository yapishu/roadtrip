#!/usr/bin/env python3
"""Share road elevations across terrain sections and park revisits."""
import argparse,importlib.util,json
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
spec=importlib.util.spec_from_file_location('profiles',Path(__file__).with_name('refine-road-profiles.py'));profiles=importlib.util.module_from_spec(spec);spec.loader.exec_module(profiles)
a=argparse.ArgumentParser();a.add_argument('--trip',type=Path,required=True);trip=a.parse_args().trip;paths=sorted((trip/'world').glob('c[0-9][0-9][0-9][0-9].json'))+sorted((trip/'parks').glob('*/world/c[0-9][0-9][0-9][0-9].json'))+sorted((trip/'detours').glob('*/world/c[0-9][0-9][0-9][0-9].json'));canonical={};weights={}
for path in paths:
 d=json.loads(path.read_text());origin=np.array(d['origin']);route=cKDTree([p[1:3]for p in d['route']])
 for r in d['roads']:
  ps=np.array(r['points']);dist,_=route.query(ps[:,:2]);quality=10+1/(dist+1)+1000*((dist<90)&(d.get('roadResolution')==2));ps[:,:2]+=origin;key=r['id']
  if key not in canonical or len(ps)>len(canonical[key]['points']):canonical[key]={**r,'points':ps};weights[key]=quality
  elif ps.shape==canonical[key]['points'].shape and np.max(abs(ps[:,:2]-canonical[key]['points'][:,:2]))<.1:
   select=quality>weights[key];canonical[key]['points'][select,2]=ps[select,2];weights[key][select]=quality[select]
print(len(canonical),'shared road geometries',flush=True);profiles.connect_decks(list(canonical.values()));print('Shared bridge and tunnel profiles ready',flush=True)
for i,path in enumerate(paths):
 d=json.loads(path.read_text());origin=np.array(d['origin'])
 for r in d['roads']:
  ps=np.array(r['points']);ref=np.asarray(canonical[r['id']]['points']);dist,near=cKDTree(ref[:,:2]).query(ps[:,:2]+origin);good=dist<1;ps[good,2]=ref[near[good],2];r['points']=np.round(ps,2).tolist()
 d=profiles.refine(d,connect=False);d['sharedRoadProfiles']=True;tmp=path.with_suffix('.shared.tmp');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(path)
 if i%25==0:print(i+1,'sections share road profiles',flush=True)
print(len(paths),'sections reconciled',flush=True)
