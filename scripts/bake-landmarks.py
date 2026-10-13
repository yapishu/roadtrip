#!/usr/bin/env python3
"""Apply measured geometry to named structures visible from the scenic route."""
import argparse,json
from pathlib import Path
import numpy as np
from pyproj import Transformer
PROJECT=Transformer.from_crs(4326,5070,always_xy=True)
a=argparse.ArgumentParser();a.add_argument('--trip',type=Path,required=True);root=a.parse_args().trip
paths=list((root/'world').glob('c[0-9][0-9][0-9][0-9].json'))+list((root/'parks').glob('*/world/c[0-9][0-9][0-9][0-9].json'))
for path in paths:
 d=json.loads(path.read_text());changed=False;landmarks=[];extract=path.parent.parent/'.cache/extracts/merged'/path.name
 elements=json.loads(extract.read_text())['osm']['elements']if extract.exists()else[]
 for e in elements:
  tags=e.get('tags',{})
  if tags.get('name')=='Glen Canyon Dam'and tags.get('waterway')=='dam'and e.get('geometry'):
   ll=np.array([(v['lon'],v['lat'])for v in e['geometry']]);xy=np.column_stack(PROJECT.transform(*ll.T))-d['origin']
   if len(xy)<4:continue
   b=dict(id=e['type']+str(e['id']),points=np.round(xy,2).tolist(),holes=[],base=3715*.3048-710*.3048,height=710*.3048,heightSource='Bureau of Reclamation published dimensions',kind='dam',name='Glen Canyon Dam',roof='flat',roofHeight=0,color='#c8c3b7',roofColor='#e0d9c9',material='concrete',landmark=True,source='https://www.usbr.gov/projects/index.php?id=144')
   d['buildings']=[v for v in d['buildings']if v['id']!=b['id']]+[b];changed=True
 for b in d['buildings']:
  if b.get('name')!='Desert View Watchtower':continue
  e=next((e for e in elements if e['type']+str(e['id'])==b['id']),None)
  if not e:continue
  ll=np.array([(v['lon'],v['lat'])for v in e['geometry']]);south=ll[ll[:,1]<ll[:,1].min()+np.ptp(ll[:,1])*.24];xy=np.column_stack(PROJECT.transform(*south.T))-d['origin'];mean=xy.mean(axis=0);q=xy-mean
  if len(q)>=3:
   fit=np.linalg.lstsq(np.column_stack([q*2,np.ones(len(q))]),(q*q).sum(axis=1),rcond=None)[0];center=fit[:2]+mean
  else:center=mean
  b.update(kind='landmark',landmark=True,roof='flat',height=4.5,color='#968166',roofColor='#ad9879')
  landmarks.append(dict(kind='watchtower',name=b['name'],center=np.round(center,2).tolist(),base=b['base'],height=70*.3048,radius=15*.3048,source='https://www.nps.gov/articles/marycolter.htm'));changed=True
 if changed:
  d['landmarks']=landmarks;tmp=path.with_suffix('.landmark.tmp');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(path);print(path,len(landmarks),'landmark forms',flush=True)
# The bridge drive looks toward the dam as it passes its mapped location.
j=json.loads((root/'journey.json').read_text());dam=np.array(PROJECT.transform(-111.4837646484375,36.93754412114758));best=None
for p in (root/'world').glob('c023[23].json'):
 d=json.loads(p.read_text());r=np.array([v[:4]for v in d['route']]);xy=r[:,1:3]+d['origin'];distance=np.linalg.norm(xy-dam,axis=1);i=int(np.argmin(distance))
 if best is None or distance[i]<best[0]:best=(distance[i],float(r[i,0]))
if best:j['sources']['']['views']=[dict(name='Glen Canyon Dam',at=best[1],xy=dam.tolist())]
(root/'journey.json').write_text(json.dumps(j,separators=(',',':')))
