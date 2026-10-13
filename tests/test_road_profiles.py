"""Mapped bridge connectivity and approach-grade regressions."""
import importlib.util
import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from road_topology import physical,attach,PROJECT,merge_samples
spec=importlib.util.spec_from_file_location('profiles',Path(__file__).resolve().parents[1]/'scripts/refine-road-profiles.py');profiles=importlib.util.module_from_spec(spec);spec.loader.exec_module(profiles)

def road(points,nodes,bridge=False,tunnel=False):
 return dict(points=points,nodes=nodes,bridge=bridge,tunnel=tunnel,kind='primary',width=7,name='')

class Junctions(unittest.TestCase):
 def test_denser_remote_samples_do_not_replace_nearby_measured_elevations(self):
  near=dict(points=np.array([[0,0,10],[50,0,15],[100,0,20]]),nodes=[[0,1],[2,2]])
  far=dict(points=np.array([[0,0,500],[25,0,500],[50,0,500],[75,0,500],[100,0,500]]),nodes=[[0,1],[4,2]])
  result,quality=merge_samples(near,np.array([1000.,1000.,1000.]),far,np.ones(5))
  self.assertEqual(result['points'][:,2].tolist(),[10,12.5,15,17.5,20]);self.assertEqual(result['nodes'][-1][0],4)
  result,_=merge_samples(result,quality,near,np.full(3,2000.))
  self.assertEqual(result['points'][:,2].tolist(),[10,12.5,15,17.5,20])
 def test_ramp_meets_interior_bridge_node(self):
  roads=[road([[0,0,10],[50,0,5],[100,0,10]],[[0,'west'],[1,'merge'],[2,'east']],bridge=True),road([[50,-80,0],[50,0,0]],[[0,'ground'],[1,'merge']],bridge=True),road([[-80,0,10],[0,0,10]],[[0,'approach'],[1,'west']]),road([[100,0,10],[180,0,10]],[[0,'east'],[1,'depart']])]
  profiles.connect_decks(roads)
  self.assertEqual(roads[0]['points'][1][2],roads[1]['points'][-1][2])
  self.assertGreater(roads[0]['points'][1][2],5)
  self.assertEqual(roads[1]['points'][0][2],0)
 def test_unconnected_crossing_keeps_its_level(self):
  roads=[road([[0,0,10],[50,0,10],[100,0,10]],[[0,'west'],[1,'deck'],[2,'east']],bridge=True),road([[50,-20,0],[50,0,0],[50,20,0]],[[0,'south'],[1,'underpass'],[2,'north']])]
  profiles.connect_decks(roads)
  self.assertEqual([p[2]for p in roads[0]['points']],[10,10,10])
  self.assertEqual([p[2]for p in roads[1]['points']],[0,0,0])
 def test_bridge_joins_the_measured_approach_grade(self):
  points=[[x,0,10+x*.05]for x in range(-100,1,5)]
  roads=[road(points,[[0,'start'],[20,'west']]),road([[0,0,7],[100,0,12]],[[0,'west'],[1,'east']],bridge=True)]
  profiles.connect_decks(roads)
  self.assertEqual(roads[0]['points'][-1][2],roads[1]['points'][0][2])
  self.assertAlmostEqual(roads[1]['points'][0][2],10,places=2)
  self.assertEqual(roads[0]['points'][0][2],5)
 def test_bridge_and_tunnel_share_one_short_approach(self):
  roads=[road([[0,0,10],[50,0,12]],[[0,'west'],[1,'bridge']],bridge=True),road([[50,0,9],[70,0,7],[90,0,5]],[[0,'bridge'],[2,'portal']]),road([[90,0,9],[140,0,6]],[[0,'portal'],[1,'east']],tunnel=True)]
  profiles.connect_decks(roads)
  self.assertEqual(roads[0]['points'][-1][2],roads[1]['points'][0][2])
  self.assertEqual(roads[1]['points'][-1][2],roads[2]['points'][0][2])
 def test_attached_endpoints_are_the_last_geometry_vertices(self):
  ll=[{'lon':-119.05,'lat':35.4},{'lon':-119.049,'lat':35.401},{'lon':-119.045,'lat':35.402}]
  xy=np.column_stack(PROJECT.transform(*np.array([[p['lon'],p['lat']]for p in ll]).T))
  r=road([[*p,10]for p in xy],[])
  attach(r,ll,np.array([0,0]),[101,102,103])
  self.assertEqual(r['nodes'][-1][0],len(r['points'])-1)
  self.assertTrue(all(np.linalg.norm(np.subtract(a[:2],b[:2]))>.001 for a,b in zip(r['points'],r['points'][1:])))
 def test_same_coordinates_with_distinct_osm_nodes_do_not_join(self):
  ll=[{'lon':-119.05,'lat':35.4},{'lon':-119.049,'lat':35.401}]
  xy=np.column_stack(PROJECT.transform(*np.array([[p['lon'],p['lat']]for p in ll]).T))
  upper=road([[*p,10]for p in xy],[],bridge=True);lower=road([[*p,0]for p in xy],[])
  attach(upper,ll,np.array([0,0]),[1,2]);attach(lower,ll,np.array([0,0]),[3,4])
  profiles.connect_decks([upper,lower])
  self.assertEqual([p[2]for p in upper['points']],[10,10])
  self.assertEqual([p[2]for p in lower['points']],[0,0])
 def test_closed_bridge_network_anchors_to_its_ground_connection(self):
  roads=[road([[0,0,10],[50,0,12]],[[0,'a'],[1,'b']],bridge=True),road([[50,0,12],[25,50,8]],[[0,'b'],[1,'c']],bridge=True),road([[25,50,8],[0,0,10]],[[0,'c'],[1,'a']],bridge=True),road([[-50,0,9],[0,0,9]],[[0,'ground'],[1,'a']])]
  profiles.connect_decks(roads)
  for r in roads[:3]:self.assertEqual([p[2]for p in r['points']],[9,9])
 def test_bridge_meets_tunnel_portal_at_one_height(self):
  roads=[road([[0,0,10],[50,0,12]],[[0,'start'],[1,'portal']],bridge=True),road([[50,0,11],[150,0,15]],[[0,'portal'],[1,'finish']],tunnel=True)]
  profiles.connect_decks(roads)
  self.assertEqual(roads[0]['points'][-1][2],roads[1]['points'][0][2])
 def test_underpass_rejects_a_bridge_height_dem_spike(self):
  bridge=road([[0,-50,10],[0,50,10]],[[0,1],[1,2]],bridge=True)
  ground=road([[x,0,8 if abs(x)<10 else 0]for x in range(-100,101,5)],[[0,3],[40,4]])
  profiles.connect_decks([bridge,ground])
  self.assertEqual(max(p[2]for p in ground['points']),0)
  self.assertEqual([p[2]for p in bridge['points']],[10,10])
 def test_connected_approach_keeps_its_rise_into_the_deck(self):
  bridge=road([[0,0,10],[0,100,10]],[[0,1],[1,2]],bridge=True)
  ground=road([[-50,0,0],[-25,0,5],[0,0,10]],[[0,3],[2,1]])
  profiles.connect_decks([bridge,ground])
  self.assertEqual([p[2]for p in ground['points']],[0,5,10])
 def test_underpass_ramp_uses_its_connected_ground_node(self):
  bridge=road([[0,-50,10],[0,50,10]],[[0,1],[1,2]],bridge=True)
  freeway=road([[-100,0,0],[-10,0,0],[100,0,0]],[[0,3],[1,4],[2,5]])
  ramp=road([[x,(x+10)*.1,8 if x<10 else 0]for x in range(-10,101,5)],[[0,4],[22,6]])
  profiles.connect_decks([bridge,freeway,ramp])
  self.assertEqual(max(p[2]for p in ramp['points']),0)
 def test_unbuilt_roads_do_not_form_physical_geometry(self):
  for kind in ['proposed','construction','abandoned','razed','planned','demolished']:
   self.assertFalse(physical({'highway':kind,'bridge':'yes'}))
  self.assertTrue(physical({'highway':'motorway_link','bridge':'yes'}))

def scenic_road(points,bridge=False,tunnel=False,name='Scenic Drive'):
 return dict(points=points,nodes=[[i,f'{p[0]},{p[1]}']for i,p in enumerate(points)],bridge=bridge,tunnel=tunnel,width=7,kind='primary',name=name)
def drive():
 return [[s,0,s,0,7,'primary','',0,0]for s in range(0,101,5)]
class RoadProfiles(unittest.TestCase):
 def test_split_bridge_spans_river_and_crossing_road(self):
  d=dict(roads=[scenic_road([[0,0,100.12],[0,50,5.12]],bridge=True),scenic_road([[0,50,5.12],[0,100,100.12]],bridge=True),scenic_road([[-20,50,5.12],[20,50,5.12]],name='River Road')],route=drive())
  result=profiles.refine(d)
  for point in result['route']:
   self.assertAlmostEqual(point[3],100,places=2);self.assertEqual(point[6],'Scenic Drive');self.assertEqual(point[7],1)
  for r in result['roads'][:2]:
   for point in r['points']:self.assertAlmostEqual(point[2],100.12,places=2)
  self.assertEqual(result['roads'][2]['points'][0][2],5.12)
 def test_split_tunnel_connects_portals_beneath_ridge(self):
  d=dict(roads=[scenic_road([[0,0,100.12],[0,50,500.12]],tunnel=True),scenic_road([[0,50,500.12],[0,100,110.12]],tunnel=True)],route=drive())
  result=profiles.refine(d)
  self.assertAlmostEqual(result['roads'][0]['points'][-1][2],105.12,places=2)
  for point in result['route'][2:-2]:self.assertAlmostEqual(point[3],100+point[0]*.1,delta=.03)
 def test_tunnel_portal_uses_open_road_beneath_overhang(self):
  approach=scenic_road([[0,y,100.12 if y<0 else 200.12]for y in range(-100,1,10)])
  d=dict(roads=[approach,scenic_road([[0,0,200.12],[0,100,100.12]],tunnel=True)],route=drive())
  result=profiles.refine(d)
  self.assertAlmostEqual(result['roads'][1]['points'][0][2],100.12,places=2)
  for point in result['route']:self.assertAlmostEqual(point[3],100,places=2)
 def test_isolated_ground_depression_keeps_road_on_approaches(self):
  points=[[0,y,80.12 if 40<=y<=60 else 100.12]for y in range(0,101,5)]
  result=profiles.refine(dict(roads=[scenic_road(points)],route=drive()))
  self.assertGreater(min(p[3]for p in result['route']),98)
  self.assertGreater(min(p[2]for p in result['roads'][0]['points']),98)

if __name__=='__main__':unittest.main()
