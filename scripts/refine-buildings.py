#!/usr/bin/env python3
"""Refresh building semantics and mapped parts without changing roads or terrain."""
import argparse
import importlib.util
import json
import shutil
from collections import Counter
from pathlib import Path
import numpy as np
from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree
from shapely.ops import unary_union
from building_metadata import attributes

spec = importlib.util.spec_from_file_location('bake_world', Path(__file__).with_name('bake-world.py'))
bake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bake)


def refine(data, elements, dem):
    origin = np.asarray(data['origin'])
    by_id = {e['type']+str(e['id']): e for e in elements}
    zones, uses, pois, poi_tags = [], [], [], []
    for e in elements:
        tags = e.get('tags', {})
        if tags.get('landuse') in ('commercial', 'retail', 'industrial', 'residential'):
            for p in bake.polygons(e):
                zones.append(p); uses.append(tags['landuse'])
        if e['type'] == 'node' and 'lon' in e and any(tags.get(k) for k in ('shop', 'office', 'amenity', 'tourism')):
            pois.append(Point(*bake.PROJECT.transform(e['lon'], e['lat']))); poi_tags.append(tags)
    zone_tree = STRtree(zones)
    poi_tree = STRtree(pois)
    buildings = []
    existing_ids = {b['id'] for b in data['buildings']}
    for b in data['buildings']:
        e = by_id.get(b['id'])
        if not e or b.get('landmark'):
            buildings.append(b); continue
        tags = dict(e.get('tags', {}))
        p = Polygon(np.asarray(b['points'])+origin, [np.asarray(h)+origin for h in b.get('holes', [])]).buffer(0)
        if tags.get('building') in ('yes', None):
            candidates = zone_tree.query(p.representative_point(), predicate='intersects')
            if len(candidates): tags['_landuse'] = uses[min(candidates, key=lambda i: zones[i].area)]
            candidates = poi_tree.query(p, predicate='contains')
            if len(candidates) == 1:
                for key in ('shop', 'office', 'amenity', 'tourism'):
                    if key in poi_tags[candidates[0]]: tags.setdefault(key, poi_tags[candidates[0]][key])
        values = attributes(tags, p.area)
        # Preserve existing elevations and mapped/sourced building heights.
        for key in ('height', 'heightSource'):
            values[key] = b[key]
        if values['kind'] == 'canopy' and b['heightSource'] == 'estimated': values['height'] = 3.6
        buildings.append({**b, **values})
    grid = {**data['near'], 'x0':data['near']['x0']+origin[0], 'y0':data['near']['y0']+origin[1]}
    parents = [b for b in buildings if not b.get('part') and not b.get('landmark')]
    parent_shapes = [Polygon(b['points'], b['holes']).buffer(0) for b in parents]
    parent_tree = STRtree(parent_shapes)
    for key, e in by_id.items():
        tags = e.get('tags', {})
        if key in existing_ids or tags.get('building:part') in (None, 'no') or tags.get('building') == 'no' or tags.get('location') == 'underground': continue
        for p in bake.polygons(e):
            if p.area < 5: continue
            points = np.asarray(p.exterior.coords)
            local = Polygon(points-origin)
            matches = [i for i in parent_tree.query(local) if parent_shapes[i].buffer(.15).covers(local)]
            parent = parents[min(matches, key=lambda i:parent_shapes[i].area)] if matches else None
            inherited = {}
            if parent:
                parent_tags = by_id.get(parent['id'], {}).get('tags', {})
                inherited = {k:v for k,v in parent_tags.items() if k in ('building','amenity','shop','office','tourism','building:colour','building:material','roof:shape','roof:material','roof:colour')}
            values = attributes({**inherited, **tags}, p.area)
            if parent and not any(k in tags for k in ('height','building:levels')):
                values['height'],values['heightSource'] = parent['height'],parent['heightSource']
            buildings.append(dict(id=key, points=np.round(points-origin, 2).tolist(),
                holes=[np.round(np.asarray(r.coords)-origin, 2).tolist() for r in p.interiors],
                base=parent['base'] if parent else round(float(np.median(bake.sample(grid, dem, points))), 2), name=tags.get('name'),
                **values))
    # A mapped part replaces only its footprint in the enclosing shell.
    parts = [Polygon(b['points'], b['holes']).buffer(0) for b in buildings if b.get('part')]
    part_tree = STRtree(parts)
    result = []
    for b in buildings:
        if b.get('part') or b.get('landmark') or b['kind'] == 'canopy': result.append(b); continue
        p = Polygon(b['points'], b['holes']).buffer(0)
        contained = [parts[i] for i in part_tree.query(p) if p.buffer(.15).covers(parts[i])]
        if not contained: result.append(b); continue
        rest = p.difference(unary_union(contained))
        pieces = [rest] if rest.geom_type == 'Polygon' else list(rest.geoms)
        for i, q in enumerate(pieces):
            if q.area < 5: continue
            result.append({**b, 'id':b['id']+f':shell{i}', 'points':list(map(list,q.exterior.coords)),
                           'holes':[list(map(list,r.coords)) for r in q.interiors]})
    data['buildings'] = result
    return Counter(b['kind'] for b in result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trip', type=Path, required=True)
    parser.add_argument('--sources', help='Comma-separated relative sources; main is an empty string')
    args = parser.parse_args()
    root = args.trip.resolve()
    reference_file = root/'building-references.json'
    references = json.loads(reference_file.read_text()) if reference_file.exists() else {}
    sources = args.sources.split(',') if args.sources is not None else json.loads((root/'journey.json').read_text())['sources'].keys()
    counts = Counter(); chunks = 0
    for source in sources:
        trip = root/source
        for path in sorted((trip/'world').glob('c[0-9][0-9][0-9][0-9].json')):
            extract = trip/'.cache/extracts/merged'/path.name
            if not extract.exists(): raise FileNotFoundError(extract)
            backup = trip/'.cache/buildings-baseline'/path.name
            backup.parent.mkdir(parents=True, exist_ok=True)
            if not backup.exists(): shutil.copy2(path, backup)
            data = json.loads(path.read_text())
            # Start with the retained source shapes so repeat runs do not split shells again.
            data['buildings'] = json.loads(backup.read_text())['buildings']
            grid = data['near']
            dem = np.fromfile(path.parent/grid['file'], '<u2').reshape(grid['h'],grid['w'])*grid['scale']+grid['offset']
            counts.update(refine(data, json.loads(extract.read_text())['osm']['elements'], dem))
            for building in data['buildings']:
                if building['id'] in references:
                    building.update(references[building['id']])
            bake.write_json(path, data); chunks += 1
            print(f'{source or "main"}/{path.stem}: {len(data["buildings"])} structures', flush=True)
    print(json.dumps(dict(chunks=chunks, instances=counts)), flush=True)


if __name__ == '__main__': main()
