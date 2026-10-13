import importlib.util
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from building_metadata import attributes, building_kind, number


class BuildingAttributes(unittest.TestCase):
    def test_canopies_and_offices_have_distinct_forms(self):
        self.assertEqual(building_kind({'building':'roof','amenity':'fuel'}, 200), 'canopy')
        self.assertEqual(building_kind({'building':'office'}, 200), 'office')
        self.assertEqual(building_kind({'building':'retail','name':'Gas Station'}, 200), 'shop')

    def test_small_commercial_footprints_are_not_houses(self):
        self.assertEqual(building_kind({'building':'yes','_landuse':'commercial'}, 180), 'commercial')
        self.assertEqual(building_kind({'building':'house','_landuse':'commercial'}, 180), 'house')

    def test_mapped_dimensions_use_metres_and_retain_part_clearance(self):
        a=attributes({'building:part':'yes','height':'40 ft','min_height':'10 ft','building:levels':'3','roof:shape':'hipped','roof:direction':'90'}, 200)
        self.assertEqual(a['height'],12.19)
        self.assertEqual(a['minHeight'],3.05)
        self.assertEqual(a['levels'],3)
        self.assertEqual(a['roofDirection'],'90')
        self.assertTrue(a['part'])
        self.assertEqual(a['heightSource'],'mapped')
        self.assertAlmostEqual(number('6\'5"'),1.9558)

    def test_parts_keep_their_explicit_building_use(self):
        self.assertEqual(building_kind({'building':'office','building:part':'yes'}, 200), 'office')
        self.assertEqual(building_kind({'building:part':'porch'}, 20), 'canopy')


if __name__ == '__main__': unittest.main()
