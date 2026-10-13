"""Retain mapped natural and recreational multipolygons within the road corridor."""
import json,pathlib,sys,time,importlib.util
import osmium
from shapely.geometry import Polygon,MultiPolygon
from shapely import make_valid
root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('maps',root/'extract-maps.py');maps=importlib.util.module_from_spec(spec);spec.loader.exec_module(maps)
out=root/'.cache/natural';out.mkdir(exist_ok=True);regions=sys.argv[1:];affected=set()
for region in regions:
 start=time.monotonic();kept=0;count=0;buckets={}
 fp=osmium.FileProcessor(str(root/'.cache/regions'/(region+'.osm.pbf'))).with_locations('sparse_mem_array').with_areas().with_filter(osmium.filter.EntityFilter(osmium.osm.AREA)).with_filter(osmium.filter.KeyFilter('natural','leisure'))
 for o in fp:
  if o.from_way():continue
  tags=dict(o.tags)
  if tags.get('natural') not in ['wood','grassland','wetland','sand','bare_rock','scree','scrub','heath','desert','beach'] and tags.get('leisure') not in ['park','garden','pitch','golf_course','playground','common']:continue
  count+=1;polys=[]
  for outer in o.outer_rings():
   points=[maps.xy((n.lon,n.lat)) for n in outer if n.location.valid()]
   if len(points)<4:continue
   holes=[[maps.xy((n.lon,n.lat)) for n in ring if n.location.valid()] for ring in o.inner_rings(outer)]
   polys.append(Polygon(points,[h for h in holes if len(h)>=4]))
  if not polys:continue
  geom=MultiPolygon(polys);geom=geom if geom.is_valid else make_valid(geom)
  ids=maps.trees[275].query(geom,predicate='intersects')
  if not len(ids):continue
  kept+=1
  for c in ids:
   c=int(c);clipped=geom.intersection(maps.buffers[275][c]);parts=[clipped] if clipped.geom_type=='Polygon' else list(clipped.geoms) if hasattr(clipped,'geoms') else []
   members=[]
   for poly in parts:
    if poly.geom_type!='Polygon':continue
    for role,ring in [('outer',poly.exterior)]+[('inner',r) for r in poly.interiors]:members.append({'type':'way','role':role,'geometry':[{'lon':x/90000,'lat':y/111000} for x,y in ring.coords]})
   if members:buckets.setdefault(c,[]).append({'type':'relation','id':o.orig_id(),'tags':tags,'members':members});affected.add(c)
 for c,elements in buckets.items():
  file=out/f'c{c:04}.json';old=json.loads(file.read_text()) if file.exists() else [];by_id={e['id']:e for e in old+elements};file.write_text(json.dumps(list(by_id.values()),separators=(',',':')))
 print(f'{region}: {count} natural multipolygons scanned, {kept} retained, {len(buckets)} chunks; {time.monotonic()-start:.1f}s',flush=True)
(out/'affected.json').write_text(json.dumps(sorted(affected)))
print('Natural areas extracted',flush=True)
