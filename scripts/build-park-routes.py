#!/usr/bin/env python3
"""Trace scenic park drives over mapped roads and prepare their terrain extracts."""
import argparse,json,math
from collections import Counter
from pathlib import Path
import numpy as np
import osmium
import networkx as nx
from scipy.spatial import cKDTree
from pyproj import Transformer
from road_topology import physical
PROJECT=Transformer.from_crs(4326,5070,always_xy=True)
def write(path,value):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,separators=(',',':')))
def cum(line):
 q=np.radians(line);d=np.diff(q,axis=0);h=np.sin(d[:,1]/2)**2+np.cos(q[:-1,1])*np.cos(q[1:,1])*np.sin(d[:,0]/2)**2
 return np.r_[0,np.cumsum(6371000*2*np.arctan2(np.sqrt(h),np.sqrt(1-h)))]
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--trip',type=Path,required=True);ap.add_argument('--region',required=True);ap.add_argument('--only');a=ap.parse_args();trip=a.trip.resolve();base=json.loads((trip/'route.json').read_text());parks=[]
 for path in sorted((trip/'parks').glob('*/plan.json'))+sorted((trip/'detours').glob('*/plan.json')):
  p=json.loads(path.read_text())
  if p['region']!=a.region or (a.only and p['id']!=a.only):continue
  p['dir']=path.parent;ll=np.array([[s['lon'],s['lat']]for s in p['stops']]);p['box']=[ll[:,0].min()-.15,ll[:,1].min()-.15,ll[:,0].max()+.15,ll[:,1].max()+.15];p['elements']=[];parks.append(p)
 if not parks:return
 if all((p['dir']/'map.json').exists()for p in parks):
  for p in parks:p['elements']=json.loads((p['dir']/'map.json').read_text())['elements']
 else:
  source=trip/'.cache/regions'/(a.region+'-latest.osm.pbf')
  if not source.exists():source=next((trip/'.cache').rglob(a.region+'*.osm.pbf'))
  fp=osmium.FileProcessor(str(source)).with_locations('flex_mem').with_filter(osmium.filter.EntityFilter(osmium.osm.WAY)).with_filter(osmium.filter.KeyFilter('highway','building','building:part','natural','landuse','waterway','tourism','amenity','aerialway','piste:type','barrier','man_made'))
  for way in fp:
   if not way.nodes or not way.nodes[0].location.valid():continue
   ll=[(n.lon,n.lat)for n in way.nodes if n.location.valid()]
   if len(ll)<2:continue
   west=min(v[0]for v in ll);east=max(v[0]for v in ll);south=min(v[1]for v in ll);north=max(v[1]for v in ll)
   matched=[p for p in parks if east>=p['box'][0] and west<=p['box'][2] and north>=p['box'][1] and south<=p['box'][3]]
   if not matched:continue
   e=dict(type='way',id=way.id,tags=dict(way.tags),nodes=[n.ref for n in way.nodes],geometry=[dict(lon=x,lat=y)for x,y in ll])
   for p in matched:p['elements'].append(e)
  for p in parks:write(p['dir']/'map.json',dict(elements=p['elements']));print(p['id'],len(p['elements']),'mapped features',flush=True)
 for p in parks:
  graph=nx.DiGraph();coords={};references={}
  for e in p['elements']:
   t=e['tags'];kind=t.get('highway')
   if kind in p.get('avoidHighways',[]):continue
   if not physical(t)or kind in ['footway','path','cycleway','steps','pedestrian','bridleway','platform','raceway']:continue
   ll=[(v['lon'],v['lat'])for v in e['geometry']];ids=e['nodes'];lengths=np.diff(cum(ll));one=t.get('oneway','yes'if t.get('junction')=='roundabout'else'no')
   coords.update(zip(ids,ll))
   refs={r.replace(' ','').upper()for r in t.get('ref','').split(';')if r}
   for ref in refs:references.setdefault(ref,set()).update(ids)
   preferred=bool(refs&{ref.replace(' ','').upper()for ref in p.get('preferRoadRefs',[])})
   for u,v,length in zip(ids[:-1],ids[1:],lengths):
    weight=float(length)*(1.12 if kind in ['service','track']else 1)*(.8 if preferred else 1)
    if one!='-1':graph.add_edge(u,v,weight=weight,length=float(length),kind=kind,name=t.get('name',''),ref=t.get('ref',''))
    if one not in ['yes','1']:graph.add_edge(v,u,weight=weight,length=float(length),kind=kind,name=t.get('name',''),ref=t.get('ref',''))
  ids=list(graph);xy=np.column_stack(PROJECT.transform(*np.array([coords[i]for i in ids]).T));tree=cKDTree(xy);stops=p['stops'];nodes=[]
  # The virtual tour follows physical roads regardless of seasonal vehicle access.
  for stop in stops:
   candidate_ids=[i for i in ids if i in references.get(stop['roadRef'].replace(' ','').upper(),set())]if stop.get('roadRef')else ids
   if not candidate_ids:raise ValueError(f'No mapped road reference for {stop}')
   candidate_tree=cKDTree(np.column_stack(PROJECT.transform(*np.array([coords[i]for i in candidate_ids]).T)))if stop.get('roadRef')else tree
   dist,nearest=candidate_tree.query(PROJECT.transform(stop['lon'],stop['lat']),k=min(40,len(candidate_ids)))
   candidates=[candidate_ids[int(j)]for j in np.atleast_1d(nearest)]
   selected=None
   for node in candidates:
    if not nodes or nx.has_path(graph,nodes[-1],node):selected=node;break
   if selected is None:raise ValueError(f'No connected road for {stop["name"]}')
   nodes.append(selected);print(p['id'],stop['name'],round(float(np.linalg.norm(np.array(PROJECT.transform(*coords[selected]))-PROJECT.transform(stop['lon'],stop['lat'])))),'m from road',flush=True)
  road_lengths=Counter();line=[p['anchor']];marks=[dict(name=p['name']+' · start',at=0)]
  for i in range(len(nodes)-1):
   path=nx.shortest_path(graph,nodes[i],nodes[i+1],weight='weight')
   for u,v in zip(path,path[1:]):
    edge=graph[u][v];road_lengths[(edge['kind'],edge['name'],edge['ref'])]+=edge['length']
   line.extend(coords[n]for n in path if coords[n]!=line[-1]);marks.append(dict(name=stops[i+1]['name'].split(',')[0],at=float(cum(line)[-1])))
  line.append(p.get('endAnchor',p['anchor']));dist=cum(line);marks[-1]['at']=float(dist[-1]);total=float(dist[-1]);root=p['dir'];route=dict(from_=p['name'],to=p['name'],via=p['via'],stops=marks,total=total,line=line,country='us',drive='right',units='miles',centre='yellow',themeAt=base['stops'][p['stop']]['at'],source='OpenStreetMap mapped scenic roads · '+p['source']);route['from']=route.pop('from_');route['highways']=[dict(kind=k[0],name=k[1],ref=k[2],metres=round(v,1))for k,v in road_lengths.most_common()];write(root/'route.json',route);write(root/'data/index.json',{k:v for k,v in route.items()if k!='line'})
  projected=np.column_stack(PROJECT.transform(*np.array(line).T));count=math.ceil(total/10000)
  bounds=[]
  for e in p['elements']:
   points=np.column_stack(PROJECT.transform(*np.array([(v['lon'],v['lat'])for v in e['geometry']]).T));bounds.append([points.min(axis=0),points.max(axis=0)])
  bounds=np.array(bounds)
  for c in range(count):
   subset=projected[(dist>=max(0,c*10000-500))&(dist<=min(total,(c+1)*10000+1000))];lo=subset.min(axis=0)-2200;hi=subset.max(axis=0)+2200;elements=[]
   indices=np.flatnonzero(np.all(bounds[:,1]>=lo,axis=1)&np.all(bounds[:,0]<=hi,axis=1));elements=[p['elements'][i]for i in indices]
   write(root/f'.cache/extracts/merged/c{c:04d}.json',dict(osm=dict(elements=elements)))
  print(p['id'],round(total/1000,2),'km',count,'chunks',flush=True)
if __name__=='__main__':main()
