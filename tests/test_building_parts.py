import importlib.util
import sys
import unittest
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
spec=importlib.util.spec_from_file_location('refine_buildings',Path(__file__).resolve().parents[1]/'scripts/refine-buildings.py')
refine=importlib.util.module_from_spec(spec)
spec.loader.exec_module(refine)


class BuildingParts(unittest.TestCase):
    def test_part_replaces_its_footprint_and_leaves_other_scene_data_intact(self):
        origin=np.array([-900000,1400000])
        outer=[[0,0],[20,0],[20,20],[0,20],[0,0]]
        part=[[0,0],[10,0],[10,20],[0,20],[0,0]]
        def element(identifier,points,tags):
            ll=[refine.bake.UNPROJECT.transform(*(origin+p)) for p in np.array(points)]
            return dict(type='way',id=identifier,tags=tags,geometry=[dict(lon=x,lat=y)for x,y in ll])
        roads=[dict(id='way3',points=[[0,0,100],[20,0,100]])]
        grid=dict(x0=-10,y0=-10,cell=10,w=5,h=5)
        data=dict(origin=origin.tolist(),near=grid,roads=roads,route=[[0,0,0,100]],buildings=[dict(id='way1',points=outer,holes=[],base=100,height=7,heightSource='estimated',kind='commercial',roof='flat')])
        elements=[element(1,outer,{'building':'commercial'}),element(2,part,{'building:part':'yes','height':'14','min_height':'3'})]
        refine.refine(data,elements,np.full((5,5),100.0))
        self.assertIs(data['roads'],roads)
        self.assertIs(data['near'],grid)
        self.assertEqual(data['route'],[[0,0,0,100]])
        shapes=[Polygon(b['points'],b['holes'])for b in data['buildings']]
        self.assertAlmostEqual(sum(p.area for p in shapes),400,places=2)
        self.assertAlmostEqual(shapes[0].intersection(shapes[1]).area,0,places=2)
        tower=next(b for b in data['buildings']if b['id']=='way2')
        self.assertEqual(tower['height'],14)
        self.assertEqual(tower['minHeight'],3)
        self.assertEqual(tower['kind'],'commercial')
        self.assertEqual(tower['roof'],'flat')


if __name__=='__main__':unittest.main()
