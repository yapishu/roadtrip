"""Urban planting follows textured crowns and respects the built street."""
import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from urban_vegetation import crowns,planting_exclusions,clear_positions

class UrbanVegetation(unittest.TestCase):
    def test_smooth_lawn_does_not_become_a_forest(self):
        lawn=np.full((64,64,3),[80,130,75],dtype=np.uint8)
        self.assertEqual(crowns(lawn),[])
    def test_distinct_textured_crowns_retain_their_locations(self):
        rng=np.random.default_rng(4);image=np.full((64,64,3),150,dtype=np.uint8);yy,xx=np.indices((64,64))
        for cx in [17,46]:
            mask=(xx-cx)**2+(yy-30)**2<7**2;noise=rng.integers(-20,21,(mask.sum(),1));image[mask]=np.clip(np.array([65,110,60])+noise,0,255)
        found=crowns(image);self.assertEqual(len(found),2)
        for cx in [17,46]:self.assertTrue(any(np.hypot(x-cx,y-30)<2 for x,y,_ in found))
    def test_sparse_road_segments_and_buildings_stay_clear(self):
        data=dict(roads=[dict(points=[[-100,0,0],[100,0,0]],width=8)],buildings=[dict(points=[[10,10],[20,10],[20,20],[10,20]])])
        valid=clear_positions(planting_exclusions(data),[[0,0],[0,4.9],[0,6],[15,15],[21,15]])
        self.assertEqual(valid.tolist(),[False,False,True,False,True])
if __name__=='__main__':unittest.main()
