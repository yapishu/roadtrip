#!/usr/bin/env python3
"""Retain original OSM node IDs in cached road extracts."""
import argparse,json
from pathlib import Path
import osmium

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--trip',type=Path,required=True);a=ap.parse_args();trip=a.trip;paths=sorted((trip/'.cache/extracts/merged').glob('c????.json'))+sorted((trip/'parks').glob('*/.cache/extracts/merged/c????.json'))+sorted((trip/'detours').glob('*/.cache/extracts/merged/c????.json'));wanted=set()
 for path in paths:
  for e in json.loads(path.read_text())['osm']['elements']:
   if e['type']=='way'and e.get('tags',{}).get('highway')and'geometry'in e and'nodes'not in e:wanted.add(e['id'])
 cache=trip/'.cache/road-node-ids.json';nodes=json.loads(cache.read_text())if cache.exists()else{};wanted-=set(map(int,nodes));print(len(wanted),'ways need original node IDs',flush=True)
 for source in sorted((trip/'.cache/regions').glob('*.osm.pbf')):
  if not wanted:break
  processor=osmium.FileProcessor(str(source)).with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
  found=0
  for way in processor:
   if way.id not in wanted:continue
   nodes[str(way.id)]=[n.ref for n in way.nodes];wanted.remove(way.id);found+=1
  cache.write_text(json.dumps(nodes,separators=(',',':')));print(source.name,found,'matched;',len(wanted),'remaining',flush=True)
 if wanted:raise ValueError(f'{len(wanted)} road ways missing from source PBFs')
 updated=0
 for path in paths:
  d=json.loads(path.read_text());changed=False
  for e in d['osm']['elements']:
   if e['type']=='way'and e.get('tags',{}).get('highway')and'geometry'in e and'nodes'not in e:
    ids=nodes[str(e['id'])]
    if len(ids)!=len(e['geometry']):raise ValueError(f'Road geometry/node count differs: {e["id"]}')
    e['nodes']=ids;changed=True
  if changed:
   temp=path.with_suffix('.nodes.tmp');temp.write_text(json.dumps(d,separators=(',',':')));temp.replace(path);updated+=1
 print(updated,'road extracts retain mapped node IDs',flush=True)
if __name__=='__main__':main()
