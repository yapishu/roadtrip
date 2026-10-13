#!/usr/bin/env python3
"""Share mapped junctions and road elevations across terrain sections and revisits."""
import argparse,importlib.util,json
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
from road_topology import attach,UNBUILT,merge_samples
spec=importlib.util.spec_from_file_location('profiles',Path(__file__).with_name('refine-road-profiles.py'));profiles=importlib.util.module_from_spec(spec);spec.loader.exec_module(profiles)

def main():
 a=argparse.ArgumentParser();a.add_argument('--trip',type=Path,required=True);trip=a.parse_args().trip
 paths=sorted((trip/'world').glob('c[0-9][0-9][0-9][0-9].json'))+sorted((trip/'parks').glob('*/world/c[0-9][0-9][0-9][0-9].json'))+sorted((trip/'detours').glob('*/world/c[0-9][0-9][0-9][0-9].json'))
 canonical={};weights={}
 for path in paths:
  d=json.loads(path.read_text());origin=np.array(d['origin']);route=cKDTree([p[1:3]for p in d['route']]);roads=[r for r in d['roads']if r['kind']not in UNBUILT]
  elements=json.loads((path.parent.parent/'.cache/extracts/merged'/path.name).read_text())['osm']['elements']
  geometry={str(e['type'])+str(e['id']):e for e in elements if e.get('tags',{}).get('highway')and e['type']=='way'}
  for r in roads:
   e=geometry[r['id']];attach(r,e['geometry'],origin,e['nodes'])
   ps=np.array(r['points']);dist,_=route.query(ps[:,:2]);quality=10+1/(dist+1)+1000*((dist<90)&(d.get('roadResolution')==2));ps[:,:2]+=origin;key=r['id']
   candidate={**r,'points':ps}
   if key not in canonical:canonical[key]=candidate;weights[key]=quality
   else:canonical[key],weights[key]=merge_samples(canonical[key],weights[key],candidate,quality)
 print(len(canonical),'shared road geometries',flush=True);profiles.connect_decks(list(canonical.values()));print('Shared bridge, ramp and tunnel junctions ready',flush=True)
 for i,path in enumerate(paths):
  d=json.loads(path.read_text());origin=np.array(d['origin']);d['roads']=[r for r in d['roads']if r['kind']not in UNBUILT]
  backup=trip/'.cache/junction-repair'/path.relative_to(trip);backup.parent.mkdir(parents=True,exist_ok=True)
  if not backup.exists():backup.write_bytes(path.read_bytes())
  for r in d['roads']:
   ref=canonical[r['id']];ps=np.asarray(ref['points']).copy();ps[:,:2]-=origin;r['points']=np.round(ps,2).tolist();r['nodes']=ref['nodes']
  d=profiles.refine(d,connect=False,align_roads=False);d['sharedRoadProfiles']=True;tmp=path.with_suffix('.shared.tmp');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(path)
  if i%25==0:print(i+1,'sections share road profiles',flush=True)
 print(len(paths),'sections reconciled',flush=True)
if __name__=='__main__':main()
