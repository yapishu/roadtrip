import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('road_profiles',Path(__file__).resolve().parents[1]/'scripts/refine-road-profiles.py');profiles=importlib.util.module_from_spec(spec);spec.loader.exec_module(profiles)
def road(points,bridge=False,tunnel=False,name='Scenic Drive'):
 return dict(points=points,bridge=bridge,tunnel=tunnel,width=7,kind='primary',name=name)
def drive():
 return [[s,0,s,0,7,'primary','',0,0]for s in range(0,101,5)]
class RoadProfiles(unittest.TestCase):
 def test_split_bridge_spans_river_and_crossing_road(self):
  d=dict(roads=[road([[0,0,100.12],[0,50,5.12]],bridge=True),road([[0,50,5.12],[0,100,100.12]],bridge=True),road([[-20,50,5.12],[20,50,5.12]],name='River Road')],route=drive())
  result=profiles.refine(d)
  for point in result['route']:
   self.assertAlmostEqual(point[3],100,places=2);self.assertEqual(point[6],'Scenic Drive');self.assertEqual(point[7],1)
  for r in result['roads'][:2]:
   for point in r['points']:self.assertAlmostEqual(point[2],100.12,places=2)
  self.assertEqual(result['roads'][2]['points'][0][2],5.12)
 def test_split_tunnel_connects_portals_beneath_ridge(self):
  d=dict(roads=[road([[0,0,100.12],[0,50,500.12]],tunnel=True),road([[0,50,500.12],[0,100,110.12]],tunnel=True)],route=drive())
  result=profiles.refine(d)
  self.assertAlmostEqual(result['roads'][0]['points'][-1][2],105.12,places=2)
  for point in result['route'][2:-2]:self.assertAlmostEqual(point[3],100+point[0]*.1,delta=.03)
 def test_tunnel_portal_uses_open_road_beneath_overhang(self):
  approach=road([[0,y,100.12 if y<0 else 200.12]for y in range(-100,1,10)])
  d=dict(roads=[approach,road([[0,0,200.12],[0,100,100.12]],tunnel=True)],route=drive())
  result=profiles.refine(d)
  self.assertAlmostEqual(result['roads'][1]['points'][0][2],100.12,places=2)
  for point in result['route']:self.assertAlmostEqual(point[3],100,places=2)
 def test_isolated_ground_depression_keeps_road_on_approaches(self):
  points=[[0,y,80.12 if 40<=y<=60 else 100.12]for y in range(0,101,5)]
  result=profiles.refine(dict(roads=[road(points)],route=drive()))
  self.assertGreater(min(p[3]for p in result['route']),98)
  self.assertGreater(min(p[2]for p in result['roads'][0]['points']),98)
if __name__=='__main__':unittest.main()
