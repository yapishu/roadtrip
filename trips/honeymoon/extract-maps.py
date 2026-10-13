"""Extract the route's roads, land, buildings, place names and landmarks from OSM PBF files."""
import json,math,sys,time,pathlib,collections
import osmium
from shapely.geometry import LineString,Polygon,MultiPolygon,Point
from shapely.strtree import STRtree
from shapely import make_valid
ROOT=pathlib.Path(__file__).resolve().parent
route=json.loads((ROOT/'route.json').read_text())
line=route['line'];cum=[0.0]
for a,b in zip(line,line[1:]):
 p1,p2=math.radians(a[1]),math.radians(b[1]);dp=p2-p1;dl=math.radians(b[0]-a[0]);cum.append(cum[-1]+2*6371008.8*math.asin(min(1,math.sqrt(math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2))))
count=math.ceil(cum[-1]/10000)
# A conservative metric projection retains a margin at every latitude on this route.
xy=lambda p:(p[0]*90000,p[1]*111000)
chunk_points=[[] for _ in range(count)]
for i,p in enumerate(line):
 c=min(count-1,int(cum[i]//10000));chunk_points[c].append(xy(p))
 if i and int(cum[i-1]//10000)!=c:
  chunk_points[c].insert(0,xy(line[i-1]));chunk_points[c-1].append(xy(p))
paths=[LineString(p) for p in chunk_points]
buffers={width:[p.buffer(width,quad_segs=2) for p in paths] for width in [275,1450,3000]}
trees={width:STRtree(polys) for width,polys in buffers.items()}
core_keys={'highway','building','landuse','natural','leisure','waterway','railway'}
query_keys=core_keys|{'place','wikidata','amenity'}

def geometry(coords,area=False):
 points=[xy(p) for p in coords]
 if len(points)<2:return None
 if area and len(points)>=4 and points[0]==points[-1]:
  geom=Polygon(points)
  return geom if geom.is_valid else make_valid(geom)
 return LineString(points)

def height(tags):
 try:return float(tags.get('height','').split()[0])
 except (ValueError,IndexError):
  try:return float(tags.get('building:levels',0))*3.4
  except ValueError:return 0

def extract(region):
 start=time.monotonic();source=ROOT/'.cache/regions'/(region+'.osm.pbf');out=ROOT/'.cache/extracts'/region
 if (out/'complete.json').exists():print(region+' already extracted',flush=True);return
 out.mkdir(parents=True,exist_ok=True)
 buckets=[{'osm':{},'landmarks':{},'skyline':{}} for _ in range(count)]
 seen=kept=0
 fp=osmium.FileProcessor(str(source)).with_locations('sparse_mem_array').with_areas().with_filter(osmium.filter.KeyFilter(*query_keys))
 for o in fp:
  seen+=1
  if seen%200000==0:print(f'{region}: {seen:,} objects scanned; {kept:,} retained; {time.monotonic()-start:.0f}s',flush=True)
  if o.is_relation() or (o.is_area() and o.from_way()):continue
  tags=dict(o.tags);landmark='wikidata' in tags and 'name' in tags
  if o.is_node():
   if not o.location.valid() or not (tags.get('place') and tags.get('name') or landmark):continue
   coords=(o.lon,o.lat);geom=Point(xy(coords));element={'type':'node','id':o.id,'lon':o.lon,'lat':o.lat,'tags':tags}
   groups={}
   if tags.get('place') and tags.get('name'):groups['osm']=trees[3000].query(geom,predicate='intersects')
   if landmark:groups['landmarks']=trees[1450].query(geom,predicate='intersects')
  elif o.is_way():
   coords=[(n.lon,n.lat) for n in o.nodes if n.location.valid()]
   if len(coords)<2 or len(coords)!=len(o.nodes):continue
   area=bool(tags.get('building') or tags.get('landuse') or tags.get('natural') in ['water','wood','sand','bare_rock','scrub','wetland','grassland'] or tags.get('leisure') or tags.get('amenity')=='parking')
   geom=geometry(coords,area)
   if geom is None:continue
   candidates=trees[3000].query(geom)
   if len(candidates)==0:continue
   groups={}
   if any(k in tags for k in core_keys) or tags.get('amenity')=='parking':groups['osm']=trees[275].query(geom,predicate='intersects')
   if landmark:groups['landmarks']=trees[1450].query(geom,predicate='intersects')
   if tags.get('building') and height(tags)>=28:groups['skyline']=trees[1450].query(geom,predicate='intersects')
   if not any(len(v) for v in groups.values()):continue
   lo=[p[0] for p in coords];la=[p[1] for p in coords]
   element={'type':'way','id':o.id,'tags':tags,'nodes':[n.ref for n in o.nodes],'geometry':[{'lon':p[0],'lat':p[1]} for p in coords], 'center':{'lon':(min(lo)+max(lo))/2,'lat':(min(la)+max(la))/2}}
  elif o.is_area():
   if not (tags.get('building') or tags.get('landuse') or tags.get('natural') or tags.get('leisure') or tags.get('waterway')=='riverbank' or landmark):continue
   members=[];polys=[];all_coords=[]
   for outer in o.outer_rings():
    coords=[(n.lon,n.lat) for n in outer if n.location.valid()]
    if len(coords)<4:continue
    inners=[];members.append({'type':'way','role':'outer','geometry':[{'lon':p[0],'lat':p[1]} for p in coords]});all_coords+=coords
    for inner in o.inner_rings(outer):
     hole=[(n.lon,n.lat) for n in inner if n.location.valid()]
     if len(hole)>=4:
      inners.append([xy(p) for p in hole]);members.append({'type':'way','role':'inner','geometry':[{'lon':p[0],'lat':p[1]} for p in hole]})
    polys.append(Polygon([xy(p) for p in coords],inners))
   if not polys:continue
   geom=MultiPolygon(polys);geom=geom if geom.is_valid else make_valid(geom)
   groups={'osm':trees[275].query(geom,predicate='intersects')}
   if landmark:groups['landmarks']=trees[1450].query(geom,predicate='intersects')
   if not any(len(v) for v in groups.values()):continue
   lo=[p[0] for p in all_coords];la=[p[1] for p in all_coords]
   element={'type':'relation','id':o.orig_id(),'tags':tags,'members':members,'center':{'lon':(min(lo)+max(lo))/2,'lat':(min(la)+max(la))/2}}
  else:continue
  if not any(len(v) for v in groups.values()):continue
  kept+=1;key=element['type']+':'+str(element['id'])
  for group,ids in groups.items():
   for c in ids:
    value=element if group=='osm' else {k:v for k,v in element.items() if k not in ['geometry','members']}
    buckets[int(c)][group][key]=value
 for c,data in enumerate(buckets):
  if any(data.values()):(out/f'c{c:04}.json').write_text(json.dumps({k:{'elements':list(v.values())} for k,v in data.items()},separators=(',',':')))
 (out/'complete.json').write_text(json.dumps({'region':region,'source':str(source.name),'objects':seen,'retained':kept,'seconds':time.monotonic()-start}))
 print(f'{region}: COMPLETE {seen:,} scanned, {kept:,} retained in {time.monotonic()-start:.1f}s',flush=True)

if __name__=='__main__':
 for region in sys.argv[1:]:extract(region)
