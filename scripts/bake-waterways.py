#!/usr/bin/env python3
"""Sample mapped river and stream ribbons for a scenic route.

Mapped centerlines retain their positions; untagged widths are representative.
"""
import argparse,json,re
from pathlib import Path
import numpy as np
from pyproj import Transformer
from scipy.ndimage import map_coordinates,gaussian_filter1d
from shapely.geometry import LineString,box
PROJECT=Transformer.from_crs(4326,5070,always_xy=True)

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--trip',type=Path,required=True);a=ap.parse_args()
 for path in sorted((a.trip/'world').glob('c????.json')):
  d=json.loads(path.read_text());g=d['near'];origin=np.array(d['origin']);dem=np.fromfile(path.parent/g['file'],'<u2').reshape(g['h'],g['w'])*g['scale']+g['offset'];extent=box(g['x0'],g['y0'],g['x0']+(g['w']-1)*g['cell'],g['y0']+(g['h']-1)*g['cell']);water=[];seen=set()
  for e in json.loads((a.trip/'.cache/extracts/merged'/path.name).read_text())['osm']['elements']:
   tags=e.get('tags',{});kind=tags.get('waterway');geometry=e.get('geometry',[])
   if e['type']!='way'or kind not in ('river','stream','canal')or len(geometry)<2 or e['id']in seen:continue
   if tags.get('intermittent')=='yes'or tags.get('tunnel')not in (None,'no'):continue
   seen.add(e['id']);ll=np.array([[p['lon'],p['lat']]for p in geometry]);xy=np.column_stack(PROJECT.transform(*ll.T))-origin;clipped=LineString(xy).intersection(extent);lines=[clipped]if clipped.geom_type=='LineString'else list(getattr(clipped,'geoms',[]))
   for line in lines:
    if line.geom_type!='LineString'or line.length<20:continue
    along=np.unique(np.r_[np.arange(0,line.length,8),line.length]);points=np.array([[p.x,p.y]for p in (line.interpolate(s)for s in along)]);z=map_coordinates(dem,[(points[:,1]-g['y0'])/g['cell'],(points[:,0]-g['x0'])/g['cell']],order=1,mode='nearest');z=gaussian_filter1d(z,.6)+.22
    match=re.match(r'[0-9.]+',tags.get('width',''));width=float(match[0])if match else 9 if kind=='river'else 3 if kind=='canal'else 1.8
    water.append(dict(id='way'+str(e['id']),name=tags.get('name',''),kind=kind,width=min(80,max(1,width)),points=np.round(np.column_stack([points,z]),2).tolist(),widthSource='mapped'if match else'representative'))
  target=path.with_name('w'+path.name[1:]);target.write_text(json.dumps(dict(waterways=water,source='OpenStreetMap centerlines; USGS terrain; representative untagged widths'),separators=(',',':')));d['waterwaysFile']=target.name;path.write_text(json.dumps(d,separators=(',',':')));print(path.name,len(water),'mapped waterways',flush=True)
if __name__=='__main__':main()
