import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeTerrain,roadTriangles,minorRoadSurfaces,vehicleTunnel} from '../templates/road-grade.js';

test('small path underpasses do not receive vehicle-sized tunnel shells',()=>{
  for(const kind of ['cycleway','footway','path','steps','track'])assert.equal(vehicleTunnel({kind,tunnel:true}),false);
  assert.equal(vehicleTunnel({kind:'primary',tunnel:true}),true);
  assert.equal(vehicleTunnel({kind:'primary',tunnel:false}),false);
});

// This samples the rendered triangle surface, not bilinear DEM interpolation.
function height(g,a,x,y){
  const fx=(x-g.x0)/g.cell,fy=(y-g.y0)/g.cell,ix=Math.floor(fx),iy=Math.floor(fy),u=fx-ix,v=fy-iy,k=iy*g.w+ix;
  const z=u+v<=1?a[k]*(1-u-v)+a[k+1]*u+a[k+g.w]*v:a[k+g.w+1]*(u+v-1)+a[k+1]*(1-v)+a[k+g.w]*(1-u);
  return z*g.scale+g.offset;
}
const grid={x0:-100,y0:-100,cell:10,w:31,h:31,scale:.1,offset:-500};
const road=points=>({kind:'secondary',width:7,points});
function clearance(roads,g=grid){
  const raw=new Uint16Array(g.w*g.h).fill(6200),a=gradeTerrain(roads,raw,g);let count=0;
  for(const r of roads)for(const [p,q,t]of roadTriangles(r)){
    for(let i=0;i<=20;i++)for(let j=0;j<=20-i;j++){
      const u=i/20,v=j/20,w=1-u-v,x=p[0]*w+q[0]*u+t[0]*v,y=p[1]*w+q[1]*u+t[1]*v,z=p[2]*w+q[2]*u+t[2]*v;
      assert.ok(height(g,a,x,y)<z-.33,`Terrain covers the road at ${x}, ${y}`);count++;
    }
  }
  assert.ok(count>100);assert.equal(raw[0],6200);assert.equal(a[0],6200);
}
test('a narrow diagonal road cuts through a raised bank between DEM vertices',()=>clearance([road([[1,3,100],[84,68,103]])]));
test('curves, steep slopes and intersecting road ribbons remain clear',()=>clearance([
  road([[0,4,98],[22,6,100],[36,25,105],[30,45,109],[4,52,111]]),
  road([[-30,23,99],[55,23,103]])
]));
test('two meter detail grids maintain the same road clearance',()=>clearance([road([[1,3,100],[84,68,103]])],{...grid,cell:2,w:151,h:151}));
test('cuts below the DEM encoding minimum stay below the road',()=>clearance([road([[1,3,-505],[84,68,-504]])]));
test('bridge spans and tunnels leave their underlying terrain unchanged',()=>{
  const raw=new Uint16Array(grid.w*grid.h).fill(6200);
  for(const mode of ['bridge','tunnel'])assert.deepEqual([...gradeTerrain([{...road([[1,3,100],[84,68,103]]),[mode]:true}],raw,grid)],[...raw]);
});

test('raised dirt paths stop at paved junctions without losing their approaches',()=>{
  const paved=road([[-30,0,100],[30,0,100]]);paved.width=8;
  const path={kind:'track',width:3,points:[[0,-20,100.6],[0,20,100.6]]};
  const polygons=minorRoadSurfaces([paved,path]).get(path);
  const area=polygons.reduce((total,poly)=>total+Math.abs(poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+p[0]*q[1]-p[1]*q[0];},0)/2),0);
  assert.ok(Math.abs(area-96)<1e-7);
  for(const polygon of polygons)for(const p of polygon)assert.ok(Math.abs(p[1])>=4-1e-7);
  assert.equal(minorRoadSurfaces([paved,{...path,bridge:true}]).size,0);
  assert.deepEqual(minorRoadSurfaces([{...paved,bridge:true},path]).get(path),[...roadTriangles(path)]);
});
