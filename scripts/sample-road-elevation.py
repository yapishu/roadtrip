#!/usr/bin/env python3
"""Sample native-detail road elevations across complete terrain sections."""
import argparse,concurrent.futures,importlib.util,json,hashlib,time
import requests
from scipy.spatial import cKDTree
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parent
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
world=module('world','bake-world.py');profiles=module('profiles','refine-road-profiles.py')
def needs(d):
 if d.get('roadResolution')==2:return False
 r=d['route'];ss=np.array([v[0]for v in r]);z=np.array([v[3]for v in r]);ps=np.arange(ss[0],ss[-1],5)
 return bool(d.get('roadDetail'))or np.max(np.abs(np.diff(np.interp(ps,ss,z))/5))>.20

def process(path):
 d=json.loads(path.read_text());origin=np.array(d['origin']);route_tree=cKDTree([p[1:3]for p in d['route']]);cache=path.parent.parent/'.cache/road-samples';cache.mkdir(parents=True,exist_ok=True);keys={};selections=[]
 for road in d['roads']:
  ps=np.array(road['points']);dist,_=route_tree.query(ps[:,:2]);near=np.flatnonzero(dist<90)
  if road['bridge']or road['tunnel']:indices=np.array([0,len(ps)-1])
  elif len(near):indices=np.unique(np.r_[np.arange(near[0],near[-1]+1,2),near[-1]])
  else:continue
  ids=[]
  for i in indices:
   key=tuple(np.round(ps[i,:2]+origin,2));keys.setdefault(key,len(keys));ids.append(keys[key])
  selections.append((road,ps,indices,ids))
 coordinates=list(keys);heights=np.empty(len(keys));resolutions=set();http=requests.Session()
 for start in range(0,len(coordinates),800):
  points=coordinates[start:start+800];geometry=json.dumps(dict(points=points,spatialReference=dict(wkid=5070)),separators=(',',':'));key=hashlib.sha256(geometry.encode()).hexdigest()[:24];file=cache/(key+'.json')
  if file.exists():result=json.loads(file.read_text())
  else:
   params=dict(f='json',geometry=geometry,geometryType='esriGeometryMultipoint',pixelSize=json.dumps(dict(x=2,y=2,spatialReference=dict(wkid=5070))),returnFirstValueOnly='true',interpolation='RSP_BilinearInterpolation')
   for attempt in range(4):
    try:
     response=http.post('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples',data=params,timeout=120);response.raise_for_status();result=response.json()
     if 'samples'not in result or len(result['samples'])!=len(points):raise ValueError(str(result)[:300])
     file.write_text(json.dumps(result,separators=(',',':')));break
    except Exception:
     if attempt==3:raise
     time.sleep(2**attempt)
  samples={v['locationId']:v for v in result['samples']}
  for i in range(len(points)):
   heights[start+i]=float(samples[i]['value']);resolutions.add(samples[i].get('resolution'))
 for road,ps,indices,ids in selections:
  selected=heights[ids]+.12;span=np.arange(indices[0],indices[-1]+1);distance=np.r_[0,np.cumsum(np.linalg.norm(np.diff(ps[:,:2],axis=0),axis=1))];ps[span,2]=np.interp(distance[span],distance[indices],selected);road['points']=np.round(ps,2).tolist()
 d=profiles.refine(d);d['roadResolution']=2;d['nativeRoadResolutions']=sorted(r for r in resolutions if r is not None);d['roadElevationSource']='USGS best-available elevation, two-metre sampling, connected bridge and tunnel decks';tmp=path.with_suffix('.native.tmp');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(path);print(str(path),'complete native-detail road profile',flush=True)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--trip',type=Path,required=True);ap.add_argument('--workers',type=int,default=8);ap.add_argument('--chunks');a=ap.parse_args();paths=list((a.trip/'world').glob('c[0-9][0-9][0-9][0-9].json'))+list((a.trip/'parks').glob('*/world/c[0-9][0-9][0-9][0-9].json'));paths=[p for p in paths if needs(json.loads(p.read_text()))];print(len(paths),'sections need native-detail road elevation',flush=True);errors=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers)as pool:
  futures={pool.submit(process,p):p for p in paths}
  for f in concurrent.futures.as_completed(futures):
   try:f.result()
   except Exception as e:errors.append([str(futures[f]),str(e)]);print('FAILED',futures[f],str(e),flush=True)
 print('Native-detail road profiles complete;',len(errors),'failures',flush=True)
 if errors:raise SystemExit(1)
if __name__=='__main__':main()
