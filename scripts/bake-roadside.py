#!/usr/bin/env python3
"""Place mapped roadside furniture, fences, railways and ski lifts.

Positions follow OpenStreetMap. Untagged heights and the simple rendered forms
are representative; the renderer records no claim of surveyed dimensions.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import numpy as np
import osmium
from pyproj import Transformer
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree
from shapely.geometry import Point, LineString
from shapely.strtree import STRtree

PROJECT = Transformer.from_crs(4326, 5070, always_xy=True)


def classify(tags, node):
    if node:
        if tags.get('power') in ('pole', 'tower'): return tags['power']
        if tags.get('highway') == 'street_lamp': return 'lamp'
        if tags.get('highway') == 'traffic_signals': return 'signal'
        if tags.get('highway') in ('stop', 'give_way'): return tags['highway']
        if tags.get('amenity') == 'bench': return 'bench'
        if tags.get('emergency') == 'fire_hydrant': return 'hydrant'
        if tags.get('natural') in ('rock', 'stone'): return 'boulder'
        if tags.get('highway') == 'bus_stop': return 'bus_stop'
        if tags.get('amenity') == 'waste_basket': return 'bin'
    else:
        if tags.get('aerialway') == 'chair_lift': return 'chair_lift'
        if tags.get('power') in ('line', 'minor_line'): return tags['power']
        if tags.get('barrier') in ('fence', 'wall', 'hedge', 'guard_rail'): return tags['barrier']
        if tags.get('railway') in ('rail', 'light_rail'): return 'rail'
    return None


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--trip',type=Path,required=True)
    ap.add_argument('--regions',default='california,nevada,arizona,utah,colorado,new-mexico,texas')
    ap.add_argument('--reuse',action='store_true')
    a=ap.parse_args();trip=a.trip.resolve();cache=trip/'.cache/roadside';cache.mkdir(parents=True,exist_ok=True)
    paths=sorted((trip/'world').glob('c????.json'))+sorted((trip/'parks').glob('*/world/c????.json'))+sorted((trip/'detours').glob('*/world/c????.json'))
    sections=[];buffers=[];lift_buffers=[]
    for path in paths:
        d=json.loads(path.read_text());origin=np.array(d['origin']);route=np.array([p[1:3] for p in d['route']],dtype=float);line=LineString(route+origin)
        sections.append(dict(path=path,d=d,features={}))
        buffers.append(line.buffer(180));lift_buffers.append(line.buffer(1700))
    trees={False:STRtree(buffers),True:STRtree(lift_buffers)}
    for region in a.regions.split(','):
        saved=cache/(region+'.json')
        if saved.exists() and a.reuse:
            features=json.loads(saved.read_text())
        else:
            source=next((trip/'.cache/regions').glob(region+'*.osm.pbf'))
            processor=osmium.FileProcessor(str(source)).with_locations('flex_mem').with_filter(osmium.filter.KeyFilter('power','aerialway','highway','barrier','amenity','emergency','natural','railway'))
            features=[]
            for element in processor:
                if not (element.is_node() or element.is_way()): continue
                tags=dict(element.tags);kind=classify(tags,element.is_node())
                if not kind: continue
                if element.is_node():
                    if not element.location.valid():continue
                    x,y=PROJECT.transform(element.lon,element.lat);geom=Point(x,y);points=[[x,y]]
                else:
                    ll=[(n.lon,n.lat)for n in element.nodes if n.location.valid()]
                    if len(ll)<2:continue
                    points=np.column_stack(PROJECT.transform(*np.array(ll).T)).tolist();geom=LineString(points)
                tree=trees[kind=='chair_lift']
                if not len(tree.query(geom,predicate='intersects')):continue
                features.append(dict(id=('node'if element.is_node()else'way')+str(element.id),kind=kind,points=points,tags={k:v for k,v in tags.items() if k in ('name','height','material','colour','direction','fence_type','power','aerialway')}))
            saved.write_text(json.dumps(features,separators=(',',':')))
        print(region,len(features),'mapped features',flush=True)
        for feature in features:
            points=feature['points'];geom=Point(points[0]) if len(points)==1 else LineString(points);is_lift=feature['kind']=='chair_lift'
            for i in trees[is_lift].query(geom,predicate='intersects'):
                if len(points)>1 and not is_lift:
                    clipped=geom.intersection(buffers[i]);lines=[clipped] if clipped.geom_type=='LineString' else list(getattr(clipped,'geoms',[]))
                    for j,line in enumerate(lines):
                        if line.geom_type=='LineString' and line.length>2:
                            f={**feature,'points':list(line.coords)};sections[i]['features'][feature['id']+':'+str(j)]=f
                else:sections[i]['features'][feature['id']]=feature
    counts=Counter()
    for section in sections:
        d=section['d'];g=d['near'];origin=np.array(d['origin']);dem=np.fromfile(section['path'].parent/g['file'],'<u2').reshape(g['h'],g['w'])*g['scale']+g['offset'];out=[];roadpoints=np.array([p[:2]for road in d['roads']for p in road['points']]);roadtree=cKDTree(roadpoints)
        for feature in section['features'].values():
            points=np.asarray(feature['points'])-origin
            if feature['kind']=='chair_lift':
                line=LineString(points);samples=np.unique(np.r_[np.arange(0,line.length,35),line.length]);points=np.array([[p.x,p.y]for p in (line.interpolate(s)for s in samples)])
            z=map_coordinates(dem,[(points[:,1]-g['y0'])/g['cell'],(points[:,0]-g['x0'])/g['cell']],order=1,mode='nearest')
            _,nearest=roadtree.query(points[0]);delta=roadpoints[nearest]-points[0]
            f={**feature,'points':np.column_stack((points,z)).round(2).tolist(),'facingRoad':round(float(np.arctan2(delta[0],delta[1])),4)}
            out.append(f);counts[f['kind']]+=1
        file=section['path'].with_name('r'+section['path'].name[1:]);file.write_text(json.dumps(dict(features=out,source='OpenStreetMap mapped positions; representative dimensions where untagged'),separators=(',',':')))
    (cache/'report.json').write_text(json.dumps(dict(sections=len(sections),counts=counts),indent=2))
    print(len(sections),'sections',dict(counts),flush=True)


if __name__=='__main__':main()
