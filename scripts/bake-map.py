#!/usr/bin/env python3
"""Bake a compact terrain atlas, state boundaries, and the complete driving route."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import io
import json
import math
from pathlib import Path
import zipfile

import numpy as np
from PIL import Image
from pyproj import Transformer
import requests
import shapefile
from shapely.geometry import shape, box
from shapely.ops import transform

PROJECT = Transformer.from_crs(4326, 5070, always_xy=True)
UNPROJECT = Transformer.from_crs(5070, 4326, always_xy=True)
STATES = 'https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_5m.zip'
TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'


def cumulative(ll):
    q = np.radians(ll)
    d = np.diff(q, axis=0)
    a = np.sin(d[:, 1] / 2)**2 + np.cos(q[:-1, 1])*np.cos(q[1:, 1])*np.sin(d[:, 0] / 2)**2
    return np.r_[0, np.cumsum(6371000*2*np.arctan2(np.sqrt(a), np.sqrt(1-a)))]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trip', type=Path, required=True)
    trip = parser.parse_args().trip.resolve()
    cache = trip / '.cache/map'
    cache.mkdir(parents=True, exist_ok=True)
    out = trip / 'map'
    out.mkdir(exist_ok=True)

    def fetch(url, name):
        file = cache / name
        if not file.exists():
            response = requests.get(url, timeout=90)
            response.raise_for_status()
            file.write_bytes(response.content)
        return file.read_bytes()

    journey = json.loads((trip / 'journey.json').read_text())
    routes = {}
    for source in journey['sources']:
        ll = np.array(json.loads((trip / source / 'route.json').read_text())['line'])
        routes[source] = (ll, cumulative(ll))
    route = []
    for part in journey['segments']:
        ll, ds = routes[part['source']]
        samples = np.unique(np.r_[part['start'], np.arange(part['start'], part['end'], 150), part['end']])
        x, y = PROJECT.transform(np.interp(samples, ds, ll[:, 0]), np.interp(samples, ds, ll[:, 1]))
        route.extend(np.column_stack((part['at']+samples-part['start'], x, y)).round(1).tolist())
    route = np.asarray(route)
    lo, hi = route[:, 1:].min(axis=0), route[:, 1:].max(axis=0)
    cell = 3000
    x0, y0 = np.floor((lo - 500000) / cell)*cell
    x1, y1 = np.ceil((hi + 500000) / cell)*cell
    w, h = int((x1-x0)/cell)+1, int((y1-y0)/cell)+1
    xx, yy = np.meshgrid(x0+np.arange(w)*cell, y0+np.arange(h)*cell)
    lon, lat = UNPROJECT.transform(xx, yy)
    zoom = 7
    tx = (lon+180)/360*2**zoom
    ty = (1-np.arcsinh(np.tan(np.radians(lat)))/np.pi)/2*2**zoom
    tile_x, tile_y = np.floor(tx).astype(int), np.floor(ty).astype(int)
    tiles = list(set(zip(tile_x.ravel(), tile_y.ravel())))

    def tile(key):
        x, y = key
        raw = fetch(f'{TERRAIN}/{zoom}/{x}/{y}.png', f'{zoom}-{x}-{y}.png')
        rgb = np.array(Image.open(io.BytesIO(raw))).astype(float)
        return key, rgb[:, :, 0]*256+rgb[:, :, 1]+rgb[:, :, 2]/256-32768

    heights = np.zeros((h, w))
    with ThreadPoolExecutor(max_workers=8) as pool:
        for (x, y), a in pool.map(tile, tiles):
            mask = (tile_x == x) & (tile_y == y)
            px = np.minimum(255, ((tx[mask]-x)*256).astype(int))
            py = np.minimum(255, ((ty[mask]-y)*256).astype(int))
            heights[mask] = a[py, px]
    heights.round().astype('<i2').tofile(out / 'terrain.bin')
    print(f'Terrain: {w} × {h}, {len(tiles)} source tiles', flush=True)

    archive = zipfile.ZipFile(io.BytesIO(fetch(STATES, 'states.zip')))
    stem = 'cb_2025_us_state_5m'
    reader = shapefile.Reader(shp=io.BytesIO(archive.read(stem+'.shp')),
                              shx=io.BytesIO(archive.read(stem+'.shx')),
                              dbf=io.BytesIO(archive.read(stem+'.dbf')))
    clip = box(x0, y0, x1, y1)
    states = []
    for record in reader.iterShapeRecords():
        props = record.record.as_dict()
        polygon = transform(PROJECT.transform, shape(record.shape.__geo_interface__))
        if not polygon.intersects(clip):
            continue
        point = polygon.representative_point()
        boundary = polygon.intersection(clip).simplify(700)
        polygons = list(boundary.geoms) if boundary.geom_type == 'MultiPolygon' else [boundary]
        states.append(dict(name=props['NAME'], code=props['STUSPS'],
                           label=[round(point.x), round(point.y)],
                           rings=[np.array(p.exterior.coords).round().astype(int).tolist() for p in polygons if p.geom_type == 'Polygon']))
    stops = []
    for stop in journey['stops']:
        stops.append(dict(name=stop['name'], at=stop['at'],
                          xy=[round(np.interp(stop['at'], route[:, 0], route[:, 1])),
                              round(np.interp(stop['at'], route[:, 0], route[:, 2]))]))
    metadata = dict(crs='EPSG:5070', terrain=dict(x0=x0, y0=y0, w=w, h=h, cell=cell, file='terrain.bin'),
                    bounds=[*lo.tolist(), *hi.tolist()], route=route.tolist(), states=states, stops=stops,
                    sources=[dict(name='US Census Bureau state boundaries', url=STATES),
                             dict(name='Mapzen / AWS elevation tiles', url='https://registry.opendata.aws/terrain-tiles/'),
                             dict(name='OpenStreetMap / OSRM route', url='https://www.openstreetmap.org/copyright')])
    (out / 'atlas.json').write_text(json.dumps(metadata, separators=(',', ':')))
    print(f'Atlas: {len(states)} states, {len(route)} route points, {len(stops)} stops', flush=True)


if __name__ == '__main__':
    main()
