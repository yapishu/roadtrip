#!/usr/bin/env python3
"""Complete clipped map corridors with roads attached to bridge endpoints."""
import argparse,collections,hashlib,importlib.util,json
from pathlib import Path
import numpy as np
import osmium
from road_topology import physical,UNBUILT
spec=importlib.util.spec_from_file_location('world',Path(__file__).with_name('bake-world.py'));world=importlib.util.module_from_spec(spec);spec.loader.exec_module(world)

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--trip',type=Path,required=True);a=ap.parse_args();root=a.trip;paths=sorted((root/'world').glob('c????.json'));nodes=json.loads((root/'.cache/road-node-ids.json').read_text());occurrences=collections.defaultdict(set);bridges={};instances=collections.defaultdict(set);existing=set()
 for path in paths:
  for r in json.loads(path.read_text())['roads']:
   if r['kind']in UNBUILT:continue
   rid=int(r['id'][3:]);existing.add(rid);ns=nodes[str(rid)]
   for node in ns:occurrences[node].add(rid)
   if r['bridge']:
    bridges[rid]=ns
    for node in [ns[0],ns[-1]]:instances[node].add(path)
 wanted={n for ns in bridges.values()for n in [ns[0],ns[-1]]if len(occurrences[n])==1};key=hashlib.sha256(','.join(map(str,sorted(wanted))).encode()).hexdigest()[:20];cache=root/'.cache/bridge-approaches'/(key+'.json');cache.parent.mkdir(parents=True,exist_ok=True);print(len(wanted),'bridge endpoints need adjacent-map checks',flush=True)
 if cache.exists():features=json.loads(cache.read_text())
 else:
  features={}
  for source in sorted((root/'.cache/regions').glob('*.osm.pbf')):
   count=0;processor=osmium.FileProcessor(str(source)).with_locations('flex_mem').with_filter(osmium.filter.EntityFilter(osmium.osm.WAY)).with_filter(osmium.filter.KeyFilter('highway'))
   for way in processor:
    if way.id in existing or not any(n.ref in wanted for n in way.nodes):continue
    tags=dict(way.tags)
    if not physical(tags)or any(not n.location.valid()for n in way.nodes):continue
    features[str(way.id)]=dict(type='way',id=way.id,tags=tags,nodes=[n.ref for n in way.nodes],geometry=[dict(lon=n.lon,lat=n.lat)for n in way.nodes]);count+=1
   print(source.name,count,'mapped approaches',flush=True)
  cache.write_text(json.dumps(features,separators=(',',':')))
 additions=collections.defaultdict(dict)
 for e in features.values():
  for node in set(e['nodes'])&wanted:
   for path in instances[node]:additions[path][e['id']]=e
 total=0
 for path,features in additions.items():
  d=json.loads(path.read_text());ids={r['id']for r in d['roads']};features=[e for e in features.values()if 'way'+str(e['id'])not in ids]
  if not features:continue
  extract=root/'.cache/extracts/merged'/path.name;original=json.loads(extract.read_text());known={e['id']for e in original['osm']['elements']if e['type']=='way'};original['osm']['elements'].extend(e for e in features if e['id']not in known);extract.write_text(json.dumps(original,separators=(',',':')))
  origin=np.array(d['origin']);g={**d['near'],'x0':d['near']['x0']+origin[0],'y0':d['near']['y0']+origin[1]};dem=np.fromfile(path.parent/g['file'],'<u2').reshape(g['h'],g['w'])*g['scale']+g['offset'];temporary=root/'.cache/bridge-approach-features.json';temporary.write_text(json.dumps(dict(osm=dict(elements=features))))
  _,roads,_=world.features(temporary,origin,g,dem);d['roads'].extend(roads)
  backup=root/'.cache/junction-repair'/path.relative_to(root);backup.parent.mkdir(parents=True,exist_ok=True)
  if not backup.exists():backup.write_bytes(path.read_bytes())
  temp=path.with_suffix('.approaches.tmp');temp.write_text(json.dumps(d,separators=(',',':')));temp.replace(path);total+=len(roads)
  for e in features:nodes[str(e['id'])]=e['nodes']
 (root/'.cache/road-node-ids.json').write_text(json.dumps(nodes,separators=(',',':')));print(total,'mapped approach instances in',len(additions),'sections',flush=True)
if __name__=='__main__':main()
