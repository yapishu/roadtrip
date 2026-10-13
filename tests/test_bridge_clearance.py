"""Bridge clearances include connected approaches and layered flyovers."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from bridge_clearance import constraints,raise_decks,move_camera_with_roads

def road(points,nodes,bridge=False,layer=None):
    return dict(points=points,nodes=nodes,bridge=bridge,tunnel=False,kind='primary',width=8,layer=(1 if bridge else 0) if layer is None else layer)
class Clearances(unittest.TestCase):
    def test_deck_rise_reaches_connected_approaches_across_way_boundaries(self):
        roads=[road([[x,0,2]for x in range(-50,51,5)],[[0,1],[20,2]],True),road([[0,-50,0],[0,50,0]],[[0,3],[1,4]]),road([[-100,0,0],[-50,0,2]],[[0,5],[1,1]]),road([[-200,0,0],[-100,0,0]],[[0,6],[1,5]])]
        raise_decks(roads)
        self.assertFalse(constraints(roads));self.assertEqual(roads[0]['points'][0][2],roads[2]['points'][-1][2]);self.assertEqual(roads[2]['points'][0][2],roads[3]['points'][-1][2])
        self.assertEqual(roads[3]['points'][0][2],0);self.assertEqual(roads[1]['points'][0][2],0)
    def test_layer_two_flyover_clears_a_lower_bridge(self):
        roads=[road([[-50,0,6],[0,0,6],[50,0,6]],[[0,1],[2,2]],True,2),road([[0,-50,5],[0,50,5]],[[0,3],[1,4]],True,1)]
        raise_decks(roads);self.assertFalse(constraints(roads));self.assertEqual(roads[1]['points'][0][2],5);self.assertGreaterEqual(roads[0]['points'][1][2],10.5)
    def test_connected_merge_has_no_grade_separation_constraint(self):
        roads=[road([[0,0,5],[50,0,5]],[[0,1],[1,2]],True),road([[50,0,5],[100,5,0]],[[0,2],[1,3]])]
        self.assertFalse(constraints(roads));self.assertFalse(raise_decks(roads))
    def test_slanted_ramp_clears_a_parallel_highway_lane(self):
        roads=[road([[-50,7,7],[0,2,2],[50,-3,0]],[[0,1],[2,2]],True),road([[-100,0,0],[100,0,0]],[[0,3],[1,4]])]
        raise_decks(roads);self.assertFalse(constraints(roads));self.assertGreaterEqual(min(p[2]for p in roads[0]['points']),5.5)
    def test_adjacent_ramp_does_not_force_an_overpass_above_its_own_junction(self):
        roads=[road([[0,0,5],[0,100,5]],[[0,1],[1,2]],True),road([[6,90,5],[6,140,5]],[[0,3],[1,4]])]
        self.assertFalse(constraints(roads));self.assertFalse(raise_decks(roads))
    def test_short_connecting_way_keeps_one_at_grade_junction(self):
        roads=[road([[0,0,5],[50,0,5]],[[0,1],[1,2]],True),road([[50,0,5],[55,0,5]],[[0,2],[1,3]]),road([[55,0,5],[100,5,0]],[[0,3],[1,4]])]
        self.assertFalse(constraints(roads));self.assertFalse(raise_decks(roads))
    def test_camera_keeps_its_profile_when_a_nearby_overpass_rises(self):
        lower=road([[0,0,0],[100,0,0]],[[0,1],[1,2]])
        upper=road([[0,0,5],[100,0,5]],[[0,3],[1,4]],True)
        raised=road([[0,0,10],[50,0,10],[100,0,10]],[[0,3],[2,4]],True)
        data=dict(route=[[x,x,0,.1*(x%3)]for x in range(0,101,5)])
        original=[p[3]for p in data['route']]
        move_camera_with_roads(data,[lower,upper],[lower,raised])
        self.assertEqual([p[3]for p in data['route']],original)
        data=dict(route=[[x,x,0,4.88]for x in range(0,101,5)])
        move_camera_with_roads(data,[lower,upper],[lower,raised])
        self.assertEqual([p[3]for p in data['route']],[9.88]*21)
if __name__=='__main__':unittest.main()
