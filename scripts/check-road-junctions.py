#!/usr/bin/env python3
"""Audit bridge/tunnel junction heights and driving grades in a baked scene."""
import argparse,collections,json
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
from road_topology import attach,UNBUILT

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--trip',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);a=ap.parse_args();root=a.trip;paths=sorted((root/'world').glob('c????.json'))+sorted((root/'parks').glob('*/world/c????.json'))+sorted((root/'detours').glob('*/world/c????.json'));junctions={};unbuilt=[];grades=[];seams=[];last={}
 for path in paths:
  d=json.loads(path.read_text());route=np.array([p[:4]for p in d['route']]);tree=cKDTree(route[:,1:3]);nodes=collections.defaultdict(list);backup=root/'.cache/junction-repair'/path.relative_to(root);old=json.loads(backup.read_text())if backup.exists()else d;before={r['id']:r for r in old['roads']};elements=None
  for r in d['roads']:
   if r['kind']in UNBUILT:unbuilt.append(dict(file=str(path.relative_to(root)),id=r['id'],kind=r['kind']))
   original=before.get(r['id'])
   if original and 'nodes'not in original:
    if elements is None:elements={str(e['type'])+str(e['id']):e for e in json.loads((path.parent.parent/'.cache/extracts/merged'/path.name).read_text())['osm']['elements']if e['type']=='way'and e.get('tags',{}).get('highway')}
    e=elements[r['id']];attach(original,e['geometry'],np.array(old['origin']),e['nodes'])
   old_heights={key:original['points'][i][2]for i,key in original['nodes']}if original else{}
   for index,key in r['nodes']:
    p=r['points'][index];distance,ri=tree.query(p[:2])
    if distance>180:continue
    nodes[key].append(dict(id=r['id'],structure=bool(r['bridge']or r['tunnel']),height=p[2],before=old_heights.get(key,p[2]),at=float(route[ri,0])))
  for key,roads in nodes.items():
   if len({r['id']for r in roads})<2 or not any(r['structure']for r in roads):continue
   after=max(r['height']for r in roads)-min(r['height']for r in roads);before=max(r['before']for r in roads)-min(r['before']for r in roads);record=dict(node=key,file=str(path.relative_to(root)),at=roads[0]['at'],before=round(before,2),after=round(after,2),roads=[r['id']for r in roads]);old_record=junctions.get(key)
   if old_record is None or max(after,before)>max(old_record['after'],old_record['before']):junctions[key]=record
  ss=np.arange(max(route[0,0],d['s0']),min(route[-1,0],d['s0']+d['len']),5);z=np.interp(ss,route[:,0],route[:,3]);grade=float(np.max(abs(np.diff(z)/5)))if len(z)>1 else 0
  if grade>.25:grades.append(dict(file=str(path.relative_to(root)),maxGrade=round(grade,4)))
  source=str(path.parent.relative_to(root))
  if source in last:
   prior=last[source];at=d['s0']
   if prior[0,0]<=at<=prior[-1,0]:
    jump=abs(float(np.interp(at,prior[:,0],prior[:,3])-np.interp(at,route[:,0],route[:,3])))
    if jump>1:seams.append(dict(file=str(path.relative_to(root)),jump=round(jump,2)))
  last[source]=route
 records=list(junctions.values());unresolved=[r for r in records if r['after']>.1];fixed=[r for r in records if r['before']>.5 and r['after']<=.1];report=dict(sections=len(paths),structureJunctions=len(records),fixedJunctions=len(fixed),unresolvedJunctions=unresolved,largestRepairs=sorted(fixed,key=lambda r:r['before'],reverse=True)[:30],unbuiltRoads=unbuilt,steepGrades=grades,chunkSeams=seams,scope='Shared original OSM nodes within 180 m of the driving path; five-metre grade samples within active sections; chunk boundaries')
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,indent=2));print(json.dumps({k:len(v)if isinstance(v,list)else v for k,v in report.items()},indent=2))
 if unresolved or unbuilt or grades or seams:raise SystemExit(1)
if __name__=='__main__':main()
