#!/usr/bin/env python3
"""Extract a route corridor from explicit OSM PBF files for the world baker."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import osmium
from pyproj import CRS, Transformer
from shapely import make_valid
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.strtree import STRtree


KEYS = ('highway', 'building', 'building:part', 'landuse', 'natural', 'leisure',
        'waterway', 'railway', 'place', 'wikidata', 'amenity', 'power', 'aerialway',
        'emergency', 'barrier', 'man_made', 'tourism', 'historic')
BUCKETS = ('osm', 'landmarks', 'skyline')


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, separators=(',', ':')))
    temporary.replace(path)


def cumulative(line):
    radians = np.radians(line)
    delta = np.diff(radians, axis=0)
    a = np.sin(delta[:, 1] / 2)**2 + np.cos(radians[:-1, 1]) * np.cos(radians[1:, 1]) * np.sin(delta[:, 0] / 2)**2
    return np.r_[0, np.cumsum(6371000 * 2 * np.arctan2(np.sqrt(a), np.sqrt(np.maximum(0, 1-a))))]


def extract(trip, sources, corridor, crs):
    coordinate_system = CRS.from_user_input(crs)
    if not coordinate_system.is_projected or any(not math.isclose(axis.unit_conversion_factor, 1) for axis in coordinate_system.axis_info[:2]):
        raise ValueError('Choose a projected scene CRS with meter units')
    route_file = trip / 'route.json'
    route_bytes = route_file.read_bytes()
    route = json.loads(route_bytes)
    line = np.asarray(route['line'], dtype=float)
    if len(line) < 2 or not np.isfinite(line).all():
        raise ValueError('The route needs at least two finite longitude/latitude points')
    distance = cumulative(line)
    if distance[-1] <= 0:
        raise ValueError('The route has no length')
    count = math.ceil(distance[-1] / 10000)
    project = Transformer.from_crs(4326, crs, always_xy=True)
    paths = []
    for c in range(count):
        start, end = max(0, c*10000-300), min(distance[-1], (c+1)*10000+1000)
        samples = np.unique(np.r_[start, np.arange(start, end, 100), distance[(distance >= start) & (distance <= end)], end])
        lon = np.interp(samples, distance, line[:, 0])
        lat = np.interp(samples, distance, line[:, 1])
        paths.append(LineString(np.column_stack(project.transform(lon, lat))))
    near = STRtree([path.buffer(corridor) for path in paths])
    places = STRtree([path.buffer(max(3000, corridor)) for path in paths])
    caches, source_records = [], []

    def shape(coords, area=False):
        xy = np.column_stack(project.transform(*np.asarray(coords).T))
        if area and len(coords) >= 4 and coords[0] == coords[-1]:
            return make_valid(Polygon(xy))
        return LineString(xy)

    for source in sources:
        with source.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        record = dict(file=source.name, sha256=digest)
        source_records.append(record)
        key = hashlib.sha256(route_bytes + json.dumps([digest, corridor, crs, 1]).encode()).hexdigest()[:24]
        cache = trip / '.cache/extracts' / ('pbf-' + key)
        caches.append(cache)
        if (cache / 'complete.json').exists():
            print(source.name, 'cached', flush=True)
            continue
        buckets = [{name: {} for name in BUCKETS} for _ in paths]
        processor = (osmium.FileProcessor(str(source)).with_locations('flex_mem')
                     .with_areas().with_filter(osmium.filter.KeyFilter(*KEYS)))
        retained = 0
        scanned = 0
        for element in processor:
            scanned += 1
            if scanned % 500000 == 0:
                print(source.name, scanned, 'objects scanned;', retained, 'retained', flush=True)
            if element.is_relation() or (element.is_area() and element.from_way()):
                continue
            tags = dict(element.tags)
            landmark = bool(tags.get('wikidata') and tags.get('name'))
            if element.is_node():
                if not element.location.valid():
                    continue
                geometry = Point(*project.transform(element.lon, element.lat))
                value = dict(type='node', id=element.id, lon=element.lon, lat=element.lat, tags=tags)
            elif element.is_way():
                if len(element.nodes) < 2 or any(not n.location.valid() for n in element.nodes):
                    continue
                coords = [(n.lon, n.lat) for n in element.nodes]
                area = bool(tags.get('building') or tags.get('building:part') or tags.get('landuse') or tags.get('leisure') or tags.get('natural') in ('wood', 'water', 'scrub', 'sand', 'grassland', 'wetland', 'bare_rock'))
                geometry = shape(coords, area)
                value = dict(type='way', id=element.id, tags=tags,
                             nodes=[n.ref for n in element.nodes],
                             geometry=[dict(lon=x, lat=y) for x, y in coords],
                             center=dict(lon=float(np.mean([p[0] for p in coords])), lat=float(np.mean([p[1] for p in coords]))))
            elif element.is_area():
                polygons, members, all_coords = [], [], []
                for ring in element.outer_rings():
                    if any(not n.location.valid() for n in ring):
                        continue
                    coords = [(n.lon, n.lat) for n in ring]
                    if len(coords) < 4:
                        continue
                    holes = []
                    members.append(dict(type='way', role='outer', geometry=[dict(lon=x, lat=y) for x, y in coords]))
                    all_coords.extend(coords)
                    for inner in element.inner_rings(ring):
                        if any(not n.location.valid() for n in inner):
                            continue
                        points = [(n.lon, n.lat) for n in inner]
                        if len(points) >= 4:
                            holes.append(np.column_stack(project.transform(*np.asarray(points).T)))
                            members.append(dict(type='way', role='inner', geometry=[dict(lon=x, lat=y) for x, y in points]))
                    polygons.append(Polygon(np.column_stack(project.transform(*np.asarray(coords).T)), holes))
                if not polygons:
                    continue
                geometry = make_valid(MultiPolygon(polygons))
                value = dict(type='relation', id=element.orig_id(), tags=tags, members=members,
                             center=dict(lon=float(np.mean([p[0] for p in all_coords])), lat=float(np.mean([p[1] for p in all_coords]))))
            else:
                continue
            candidates = near.query(geometry, predicate='intersects')
            if element.is_node() and tags.get('place'):
                candidates = places.query(geometry, predicate='intersects')
            if not len(candidates):
                continue
            retained += 1
            key = f"{value['type']}:{value['id']}"
            try:
                height = float(tags['height'].split()[0]) if tags.get('height') else float(tags.get('building:levels', 0))*3.4
            except ValueError:
                height = 0
            for c in candidates:
                buckets[int(c)]['osm'][key] = value
                compact = {k: v for k, v in value.items() if k not in ('geometry', 'members', 'nodes')}
                if landmark:
                    buckets[int(c)]['landmarks'][key] = compact
                if (tags.get('building') or tags.get('building:part')) and height >= 28:
                    buckets[int(c)]['skyline'][key] = compact
        for c, bucket in enumerate(buckets):
            write_json(cache / f'c{c:04d}.json', {name: dict(elements=list(values.values())) for name, values in bucket.items()})
        write_json(cache / 'complete.json', dict(source=record, retained=retained, chunks=count))
        print(source.name, retained, 'retained features', flush=True)

    missing = []
    for c in range(count):
        merged = {name: {} for name in BUCKETS}
        for cache in caches:
            data = json.loads((cache / f'c{c:04d}.json').read_text())
            for name in BUCKETS:
                for element in data[name]['elements']:
                    merged[name][f"{element['type']}:{element['id']}"] = element
        if not any(e.get('tags', {}).get('highway') for e in merged['osm'].values()):
            missing.append(c)
        write_json(trip / f'.cache/extracts/merged/c{c:04d}.json',
                   {name: dict(elements=list(values.values())) for name, values in merged.items()})
    write_json(trip / '.cache/extracts/manifest.json', dict(sources=source_records, crs=crs,
               corridor=corridor, chunks=count, missingRoadCoverage=missing))
    if missing:
        raise ValueError(f'No mapped road coverage in chunks {missing}; supply the missing regional extracts')
    print(count, 'merged route chunks ready', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trip', type=Path, required=True)
    parser.add_argument('--pbf', type=Path, action='append', required=True)
    parser.add_argument('--corridor', type=float, default=2200)
    parser.add_argument('--crs', default='EPSG:5070', help='Metric scene CRS shared with the world baker')
    args = parser.parse_args()
    if args.corridor <= 0:
        parser.error('--corridor must be positive')
    extract(args.trip.resolve(), [p.resolve() for p in args.pbf], args.corridor, args.crs)


if __name__ == '__main__':
    main()
