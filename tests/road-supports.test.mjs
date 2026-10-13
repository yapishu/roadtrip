import test from 'node:test';
import assert from 'node:assert/strict';
import {roadSupports} from '../templates/road-supports.js';
const road=(points,bridge=false)=>({points,bridge,width:8,kind:'primary'});
test('elevated approaches have banks that reach the terrain',()=>{
 const result=roadSupports([road([[0,0,5],[30,0,5]])],()=>0);
 assert.ok(result.earth.length>=2);
 assert.equal(Math.max(...result.earth.flat().map(p=>p[2])),5.08);
 assert.equal(Math.min(...result.earth.flat().map(p=>p[2])),-.1);
 assert.ok(result.rails.length>2);
});
test('banks and abutments leave lower roads clear',()=>{
 const crossing=road([[15,-30,0],[15,30,0]]),approach=road([[0,0,5],[30,0,5]]);
 const banks=roadSupports([approach,crossing],()=>0).earth;
 assert.ok(banks.length>0,'The banks remain on both sides of the crossing');
 for(const face of banks)for(const p of face)assert.ok(p[0]<=10.5+1e-7||p[0]>=19.5-1e-7);
 const deck=road([[15,0,6],[45,0,6]],true);
 const result=roadSupports([deck,crossing],()=>0);
 const abutments=result.concrete.filter(face=>face.every(p=>p[0]===face[0][0]));
 assert.equal(abutments.length,1);assert.ok(abutments[0].every(p=>p[0]===45));
});
test('ground-level pavement and tunnels need no supporting bank',()=>{
 const tunnel={...road([[0,0,5],[30,0,5]]),tunnel:true};
 assert.deepEqual(roadSupports([road([[0,0,.25],[30,0,.25]]),tunnel],()=>0),{earth:[],concrete:[],rails:[]});
});
test('banks leave intersecting roads at the same height clear',()=>{
 const main=road([[0,0,5],[30,0,5]]),side=road([[15,-30,5],[15,30,5]]);
 const result=roadSupports([main,side],()=>3.3);
 assert.ok(result.earth.length>0);
 for(const face of result.earth){const center=face.reduce((a,p)=>a.map((v,i)=>v+p[i]/face.length),[0,0,0]);
   assert.ok(!(center[0]>10.5&&center[0]<19.5&&Math.abs(center[1])<4.5));
 }
 for(const face of result.rails){const center=face.reduce((a,p)=>a.map((v,i)=>v+p[i]/face.length),[0,0,0]);assert.ok(!(center[0]>10.5&&center[0]<19.5&&Math.abs(center[1])<4.5));}
});

test('neighboring carriageways retain their outer approach banks',()=>{
 const main=road([[0,0,5],[30,0,5]]),parallel=road([[0,12,5],[30,12,5]]);
 const result=roadSupports([main,parallel],()=>0);
 assert.ok(result.earth.some(face=>face.every(p=>p[1]<=-4)));
 assert.ok(result.earth.some(face=>face.every(p=>p[1]>=16)));
});

test('bridge barriers and deck sides leave a same-height joining ramp open',()=>{
 const bridge=road([[0,0,5],[50,0,5]],true),ramp=road([[25,-30,5],[25,0,5]]);
 const {rails,concrete}=roadSupports([bridge,ramp],()=>0);
 for(const face of [...rails,...concrete]){const center=face.reduce((a,p)=>a.map((v,i)=>v+p[i]/face.length),[0,0,0]);assert.ok(!(center[0]>21.2&&center[0]<28.8&&center[1]>-5&&center[1]<0));}
});

test('inferred banks and barriers leave the driven lane clear where mapped widths overlap',()=>{
 const approach=road([[0,0,4],[50,0,4]]);
 const route=[[0,0,-6,2,8],[50,50,-6,2,8]];
 const result=roadSupports([approach],()=>0,route);
 for(const face of result.earth){const center=face.reduce((a,p)=>a.map((v,i)=>v+p[i]/face.length),[0,0,0]);assert.ok(center[1]>=-5.8||center[1]<=-10.2);}
});
