#!/usr/bin/env python3
"""Bake georeferenced terrain, aerial color and mapped structures for a driving view.

USGS 3DEP supplies elevations; USGS NAIP supplies orthophotography. OpenStreetMap
extracts supply the road network and building footprints. Source downloads stay
in the trip cache. Output coordinates use metres in EPSG:5070, relative to each
chunk's origin. Unknown building heights are explicitly marked as estimates.
"""
import argparse
import concurrent.futures
import io
import json
import math
import os
from pathlib import Path
import re
import threading
import time

os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif')
os.environ.setdefault('GDAL_HTTP_MAX_RETRY', '3')
os.environ.setdefault('GDAL_HTTP_RETRY_DELAY', '2')
import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds
import requests
from scipy.ndimage import map_coordinates, gaussian_filter1d
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union

DEM = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
PROJECT = Transformer.from_crs(4326, 5070, always_xy=True)
UNPROJECT = Transformer.from_crs(5070, 4326, always_xy=True)
TLS = threading.local()


def write_json(path, value):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False))
    tmp.replace(path)


def fetch(url, params, path):
    if path.exists():
        return path.read_bytes()
    if not hasattr(TLS, 'http'):
        TLS.http = requests.Session()
        TLS.http.headers['User-Agent'] = 'PixelPath/1.0 personal geospatial visualization'
    for attempt in range(4):
        try:
            response = TLS.http.get(url, params=params, timeout=180)
            response.raise_for_status()
            if response.headers.get('content-type', '').startswith(('application/json', 'text/')):
                raise ValueError(response.text[:500])
            data = response.content
            tmp = path.with_suffix(path.suffix + '.tmp')
            tmp.write_bytes(data)
            tmp.replace(path)
            return data
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** (attempt + 1))


def grid_bounds(points, margin, cell):
    x0, y0 = np.floor((points.min(axis=0) - margin) / cell) * cell
    x1, y1 = np.ceil((points.max(axis=0) + margin) / cell) * cell
    return dict(x0=float(x0), y0=float(y0), w=int(round((x1-x0)/cell))+1,
                h=int(round((y1-y0)/cell))+1, cell=cell)


def bounds(g, edges=False):
    pad = g['cell'] / 2 if edges else 0
    return [g['x0']-pad, g['y0']-pad,
            g['x0']+(g['w']-1)*g['cell']+pad,
            g['y0']+(g['h']-1)*g['cell']+pad]


def near_dem(g, cache):
    data = fetch(DEM, dict(bbox=','.join(map(str, bounds(g, True))), bboxSR=5070,
        imageSR=5070, size=f"{g['w']},{g['h']}", f='image', format='tiff',
        pixelType='F32', noData=-9999, interpolation='RSP_BilinearInterpolation',
        renderingRule=json.dumps({'rasterFunction':'None'})), cache)
    with MemoryFile(data) as memory:
        with memory.open() as dataset:
            a = dataset.read(1).astype('float32')[::-1].copy()
    if a.shape != (g['h'], g['w']) or not np.isfinite(a).all() or a.min() < -499:
        raise ValueError(f'Incomplete USGS elevation grid: {cache}')
    return a


def far_dem(g, cache):
    if cache.exists():
        return np.load(cache)
    west, south, east, north = transform_bounds(5070, 4326, *bounds(g, True), densify_pts=21)
    out = np.full((g['h'], g['w']), -9999, dtype='float32')
    transform = from_origin(g['x0']-g['cell']/2,
                            g['y0']+(g['h']-.5)*g['cell'], g['cell'], g['cell'])
    for lat in range(math.floor(south)+1, math.ceil(north)+1):
        for lon in range(math.floor(west), math.ceil(east)):
            name = f'n{lat:02d}w{abs(lon):03d}'
            url = f'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/{name}/USGS_13_{name}.tif'
            with rasterio.open('/vsicurl/'+url) as source:
                reproject(source=rasterio.band(source, 1), destination=out,
                    src_transform=source.transform, src_crs=source.crs,
                    dst_transform=transform, dst_crs='EPSG:5070',
                    dst_nodata=-9999, init_dest_nodata=False, resampling=Resampling.bilinear,
                    warp_mem_limit=96)
    out = out[::-1].copy()
    if not np.isfinite(out).all() or out.min() < -499:
        raise ValueError(f'Incomplete seamless elevation grid: {cache}')
    np.save(cache, out)
    return out


def aerial(g, cache, output, max_size):
    extent = bounds(g)
    width, height = extent[2]-extent[0], extent[3]-extent[1]
    scale = max_size/max(width, height)
    size = (max(1, round(width*scale)), max(1, round(height*scale)))
    data = fetch(NAIP, dict(bbox=','.join(map(str,extent)), bboxSR=5070,
        imageSR=5070, size=f'{size[0]},{size[1]}', f='image', format='jpg',
        bandIds='0,1,2', interpolation='RSP_BilinearInterpolation', compressionQuality=88), cache)
    image = Image.open(io.BytesIO(data)).convert('RGB')
    if image.size != size:
        raise ValueError(f'Wrong aerial dimensions: {cache}')
    image.save(output, 'JPEG', quality=88, optimize=True)
    return list(image.size)


def sample(g, a, points):
    p = np.asarray(points)
    return map_coordinates(a, [(p[...,1]-g['y0'])/g['cell'],
                               (p[...,0]-g['x0'])/g['cell']], order=1, mode='nearest')


def number(value, default=0):
    m = re.search(r'-?\d+(?:\.\d+)?', str(value or ''))
    if not m:
        return default
    v = float(m[0])
    return v*.3048 if re.search(r"ft|feet|'", str(value)) else v


def projected_geometry(geometry):
    ll = [(p['lon'],p['lat']) for p in geometry or [] if 'lon' in p and 'lat' in p]
    if len(ll) < 2:
        return None
    x,y = PROJECT.transform(*np.asarray(ll).T)
    return np.column_stack([x,y])


def polygons(element):
    if element['type'] == 'way':
        p = projected_geometry(element.get('geometry'))
        if p is not None and len(p) >= 4 and np.linalg.norm(p[0]-p[-1]) < 1:
            q = Polygon(p).buffer(0)
            return [q] if q.geom_type == 'Polygon' else list(q.geoms)
        return []
    outer, inner = [], []
    for member in element.get('members',[]):
        p = projected_geometry(member.get('geometry'))
        if p is not None:
            (inner if member.get('role') == 'inner' else outer).append(LineString(p))
    shells = list(polygonize(unary_union(outer))) if outer else []
    holes = unary_union(list(polygonize(unary_union(inner)))) if inner else None
    result = []
    for p in shells:
        q = p.difference(holes) if holes is not None else p
        result.extend([q] if q.geom_type == 'Polygon' else list(q.geoms))
    return result


def building_kind(t, area):
    text = ' '.join(str(t.get(k,'')) for k in ['building','amenity','shop','tourism'])
    if re.search('church|cathedral|place_of_worship', text): return 'church'
    if re.search('school|civic|public|library|museum|townhall|station', text): return 'civic'
    if re.search('industrial|warehouse|hangar|manufact', text): return 'industrial'
    if re.search('barn|farm|stable|greenhouse', text): return 'farm'
    if re.search('garage|shed|carport', text): return 'shed'
    if re.search('hotel|motel', text): return 'motel'
    if t.get('shop') or re.search('retail|commercial|office|restaurant|fuel', text): return 'shop'
    if re.search('apartments|dormitory', text): return 'apartment'
    return 'house' if area < 500 else 'commercial'


def road_width(t):
    explicit = number(t.get('width'))
    if explicit > 0: return min(40, explicit)
    lanes = number(t.get('lanes'))
    if lanes: return min(40, lanes*3.25+.8)
    return {'motorway':10.5,'trunk':8.5,'primary':7.5,'secondary':7,'tertiary':6.5,
            'residential':6.5,'unclassified':6,'service':4,'track':3,'path':1.5,
            'footway':1.5,'cycleway':2}.get(t.get('highway'),5)


def features(extract, origin, g, dem):
    buildings, roads, trees = [], [], []
    elements = json.loads(extract.read_text())['osm']['elements']
    seen = set()
    for e in elements:
        key = str(e['type'])+str(e['id'])
        if key in seen: continue
        seen.add(key)
        t = e.get('tags',{})
        if t.get('building') and t['building'] != 'no':
            for polygon in polygons(e):
                if polygon.area < 5: continue
                p = np.asarray(polygon.exterior.coords)
                kind = building_kind(t, polygon.area)
                height = number(t.get('height'))
                levels = number(t.get('building:levels'))
                mapped = bool(height or levels)
                if not height:
                    height = levels*3.1+number(t.get('roof:height'),.6) if levels else {
                        'house':4.5,'shed':2.8,'shop':4.8,'commercial':5.5,'industrial':7,
                        'farm':6,'motel':4.2,'apartment':7,'church':10,'civic':6}.get(kind,4.5)
                base = float(np.median(sample(g,dem,p)))
                buildings.append(dict(id=key, points=np.round(p-origin,2).tolist(),
                    holes=[np.round(np.asarray(r.coords)-origin,2).tolist() for r in polygon.interiors],
                    base=round(base,2), height=round(height,2), heightSource='mapped' if mapped else 'estimated',
                    kind=kind, name=t.get('name'), roof=t.get('roof:shape') or ('gabled' if kind in ['house','farm'] else 'flat'),
                    roofHeight=number(t.get('roof:height')), material=t.get('building:material'),
                    roofMaterial=t.get('roof:material'), color=t.get('building:colour'), roofColor=t.get('roof:colour')))
        if e['type']=='way' and t.get('highway') and t.get('area')!='yes':
            p = projected_geometry(e.get('geometry'))
            if p is None: continue
            line = LineString(p)
            distances = np.unique(np.r_[np.arange(0,line.length,7.5),line.length])
            dense = np.array([[q.x,q.y] for q in (line.interpolate(v) for v in distances)])
            heights = sample(g,dem,dense)
            bridge = t.get('bridge') not in (None,'no')
            tunnel = t.get('tunnel') not in (None,'no')
            if bridge or tunnel:
                heights = np.interp(distances,[0,line.length],[heights[0],heights[-1]])
            else:
                heights = gaussian_filter1d(heights,.8)
            roads.append(dict(id=key, points=np.round(np.column_stack([dense-origin,heights+.12]),2).tolist(),
                kind=t['highway'], width=road_width(t), lanes=number(t.get('lanes')),
                name=t.get('name',''), bridge=bridge, tunnel=tunnel, surface=t.get('surface'),
                oneway=t.get('oneway') in ('yes','1')))
        if e['type']=='node' and t.get('natural')=='tree' and 'lon' in e:
            p=np.array(PROJECT.transform(e['lon'],e['lat']))
            trees.append([*np.round(p-origin,2),round(float(sample(g,dem,p.reshape(1,2))[0]),2),t.get('leaf_type','')])
    return buildings,roads,trees


def cumulative(ll):
    q=np.radians(ll);d=np.diff(q,axis=0)
    h=np.sin(d[:,1]/2)**2+np.cos(q[:-1,1])*np.cos(q[1:,1])*np.sin(d[:,0]/2)**2
    return np.r_[0,np.cumsum(6371000*2*np.arctan2(np.sqrt(h),np.sqrt(1-h)))]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trip',type=Path,required=True)
    parser.add_argument('--chunks',help='Comma-separated chunk numbers; all chunks when omitted')
    parser.add_argument('--workers',type=int,default=3)
    parser.add_argument('--features-only',action='store_true')
    args=parser.parse_args();trip=args.trip.resolve();out=trip/'world';out.mkdir(exist_ok=True)
    cache=trip/'.cache/world';cache.mkdir(exist_ok=True,parents=True)
    route=json.loads((trip/'route.json').read_text());ll=np.asarray(route['line']);cum=cumulative(ll)
    total=float(cum[-1]);count=math.ceil(total/10000)
    chunks=list(map(int,args.chunks.split(','))) if args.chunks else list(range(count))
    # Explicit stop chunks are useful first, while the complete route bakes.
    priority=[215,214,196,197,87,86,152,153,253,254,279,278,0,107,124,186,201,233,294,323,340,355,383,420,431]
    chunks.sort(key=lambda c:priority.index(c) if c in priority else len(priority)+c)
    def bake(c):
        name=f'c{c:04d}';file=out/(name+'.json')
        if file.exists() and not args.features_only: return f'{name}: cached'
        start=time.time();s0=c*10000;s1=min(total,s0+10000)
        ds=np.unique(np.r_[np.arange(max(0,s0-300),min(total,s1+700),5),
            cum[(cum>=max(0,s0-300))&(cum<=min(total,s1+700))],min(total,s1+700)])
        lng=np.interp(ds,cum,ll[:,0]);lat=np.interp(ds,cum,ll[:,1]);xy=np.column_stack(PROJECT.transform(lng,lat))
        origin=np.round((xy.min(axis=0)+xy.max(axis=0))/2)
        near=grid_bounds(xy,1800,10);far=grid_bounds(xy,20000,100)
        dem=near_dem(near,cache/(name+'-near.tif'))
        if args.features_only:
            existing=json.loads(file.read_text());near=existing['near'];far=existing['far']
            near={**near,'x0':near['x0']+origin[0],'y0':near['y0']+origin[1]}
            far={**far,'x0':far['x0']+origin[0],'y0':far['y0']+origin[1]}
        else:
            distant=far_dem(far,cache/(name+'-far.npy'))
            for g,a,level in [(near,dem,'near'),(far,distant,'far')]:
                encoded=np.round((a+500)*10).astype('<u2')
                binary=out/(name+'-'+level+'.bin');encoded.tofile(binary)
                g['file']=binary.name;g['scale']=.1;g['offset']=-500
                g['min']=round(float(a.min()),1);g['max']=round(float(a.max()),1)
                g['image']=name+'-'+level+'.jpg'
                g['imageSize']=aerial(g,cache/(name+'-'+level+'.jpg'),out/g['image'],2048 if level=='near' else 768)
        structures,roads,trees=features(trip/'.cache/extracts/merged'/(name+'.json'),origin,near,dem)
        height=gaussian_filter1d(sample(near,dem,xy),1)
        road_points=[];attrs=[]
        for r in roads:
            if r['kind'] in ('footway','path','cycleway','steps','pedestrian'): continue
            for p in r['points']:
                road_points.append(p[:2]);attrs.append((r['width'],r['kind'],r['name'],r['bridge'],r['tunnel'],p[2]))
        tree=cKDTree(road_points) if road_points else None
        distances,indices=tree.query(xy-origin) if tree else (np.full(len(xy),999),np.zeros(len(xy),int))
        path=[]
        for i,(s,p,h) in enumerate(zip(ds,xy-origin,height)):
            width,kind,name2,bridge,tunnel,deck=attrs[indices[i]] if distances[i]<20 else (7,'unclassified','',False,False,h)
            if bridge or tunnel: h=deck-.12
            path.append([round(float(s),2),round(float(p[0]),2),round(float(p[1]),2),round(float(h),2),width,kind,name2,int(bridge),int(tunnel)])
        for g in [near,far]:
            g['x0']-=float(origin[0]);g['y0']-=float(origin[1])
        result=dict(c=c,s0=s0,len=s1-s0,origin=origin.tolist(),near=near,far=far,
            route=path,buildings=structures,roads=roads,trees=trees,
            sources={'elevation':'USGS 3DEP best-available dynamic DEM, 10 m grid',
                     'horizon':'USGS 1/3 arc-second seamless DEM, 100 m grid',
                     'imagery':'USGS NAIP aerial imagery','geometry':'OpenStreetMap contributors, ODbL'})
        write_json(file,result)
        return f'{name}: {len(path)} road points, {len(structures)} buildings, relief {near["min"]}–{near["max"]} m, {time.time()-start:.1f}s'
    errors=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures={pool.submit(bake,c):c for c in chunks}
        for f in concurrent.futures.as_completed(futures):
            c=futures[f]
            try: print(f.result(),flush=True)
            except Exception as e:
                errors.append([c,str(e)]);print(f'FAILED c{c:04d}: {e}',flush=True)
    ready=sorted(int(p.stem[1:]) for p in out.glob('c*.json'))
    write_json(out/'index.json',dict(crs='EPSG:5070',count=count,total=total,ready=ready,
        roadStep=5,elevationCell=10,farCell=100,errors=errors,
        sources=[{'name':'USGS 3DEP','url':'https://www.usgs.gov/3d-elevation-program'},
                 {'name':'USGS NAIP','url':'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer'},
                 {'name':'OpenStreetMap','url':'https://www.openstreetmap.org/copyright'}]))
    print(f'{len(ready)}/{count} world chunks ready; {len(errors)} failures',flush=True)
    if errors: raise SystemExit(1)


if __name__=='__main__': main()
