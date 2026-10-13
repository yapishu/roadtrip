"""Exercise corridor extraction with small generated PBF fixtures."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import osmium

spec = importlib.util.spec_from_file_location('extract_osm', Path(__file__).with_name('extract-osm.py'))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


def fixture(path, extra=False):
    with osmium.SimpleWriter(str(path)) as writer:
        coords = {
            1: (-105, 39), 2: (-104.6, 39),
            10: (-104.91, 38.995), 11: (-104.89, 38.995),
            12: (-104.89, 39.008), 13: (-104.91, 39.008),
            20: (-104.905, 39.001), 21: (-104.895, 39.001),
            22: (-104.895, 39.005), 23: (-104.905, 39.005),
        }
        for identity, location in coords.items():
            writer.add_node(osmium.osm.mutable.Node(id=identity, location=location))
        writer.add_node(osmium.osm.mutable.Node(id=30, location=(-104.8, 39), tags={'natural': 'tree'}))
        if extra:
            writer.add_node(osmium.osm.mutable.Node(id=31, location=(-104.7, 39.001), tags={'place': 'village', 'name': 'Fixture Village'}))
        writer.add_way(osmium.osm.mutable.Way(id=100, nodes=[1, 2], tags={'highway': 'secondary', 'name': 'Fixture Road'}))
        writer.add_way(osmium.osm.mutable.Way(id=200, nodes=[10, 11, 12, 13, 10]))
        writer.add_way(osmium.osm.mutable.Way(id=201, nodes=[20, 21, 22, 23, 20]))
        writer.add_relation(osmium.osm.mutable.Relation(id=300, members=[('w', 200, 'outer'), ('w', 201, 'inner')], tags={'type': 'multipolygon', 'natural': 'wood'}))


class CorridorExtraction(unittest.TestCase):
    def test_scene_coordinates_use_meters(self):
        with self.assertRaisesRegex(ValueError, 'meter units'):
            extractor.extract(Path('/unused'), [], 2200, 'EPSG:4326')

    def test_sparse_route_overlap_holes_and_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            trip = root / 'trip'
            trip.mkdir()
            (trip / 'route.json').write_text(json.dumps({'line': [[-105, 39], [-104.6, 39]]}))
            sources = [root / 'a.osm.pbf', root / 'b.osm.pbf']
            fixture(sources[0])
            fixture(sources[1], extra=True)
            extractor.extract(trip, sources, 2200, 'EPSG:5070')
            chunks = sorted((trip / '.cache/extracts/merged').glob('c*.json'))
            self.assertEqual(len(chunks), 4)
            elements = []
            for path in chunks:
                data = json.loads(path.read_text())['osm']['elements']
                roads = [e for e in data if e['type'] == 'way' and e['id'] == 100]
                self.assertEqual(len(roads), 1)
                self.assertEqual(roads[0]['nodes'], [1, 2])
                elements.extend(data)
            forest = next(e for e in elements if e['type'] == 'relation' and e['id'] == 300)
            self.assertEqual({m['role'] for m in forest['members']}, {'outer', 'inner'})
            self.assertTrue(any(e.get('tags', {}).get('name') == 'Fixture Village' for e in elements))
            self.assertTrue(any(e.get('tags', {}).get('natural') == 'tree' for e in elements))
            cache_files = list((trip / '.cache/extracts').glob('pbf-*/complete.json'))
            modified = {p: p.stat().st_mtime_ns for p in cache_files}
            extractor.extract(trip, sources, 2200, 'EPSG:5070')
            self.assertEqual(modified, {p: p.stat().st_mtime_ns for p in cache_files})

    def test_missing_source_coverage_is_an_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'route.json').write_text(json.dumps({'line': [[-103, 39], [-102.9, 39]]}))
            source = root / 'region.osm.pbf'
            fixture(source)
            with self.assertRaisesRegex(ValueError, 'No mapped road coverage'):
                extractor.extract(root, [source], 2200, 'EPSG:5070')
            report = json.loads((root / '.cache/extracts/manifest.json').read_text())
            self.assertEqual(report['missingRoadCoverage'], [0])


if __name__ == '__main__':
    unittest.main()
