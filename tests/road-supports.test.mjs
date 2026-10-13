import test from 'node:test';
import assert from 'node:assert/strict';
import {roadSupports} from '../templates/road-supports.js';
const road=(points,bridge=false)=>({points,bridge,width:8,kind:'primary'});
test('elevated approaches have banks that reach the terrain',()=>{
 const result=roadSupports([road([[0,0,5],[30,0,5]])],()=>0);
 assert.equal(result.earth.length,2);
 for(const face of result.earth){assert.equal(face[0][2],5.08);assert.equal(face[2][2],-.1);}
 assert.ok(result.rails.length>2);
});
test('banks and abutments leave lower roads clear',()=>{
 const crossing=road([[15,-30,0],[15,30,0]]),approach=road([[0,0,5],[30,0,5]]);
 assert.equal(roadSupports([approach,crossing],()=>0).earth.length,0);
 const deck=road([[15,0,6],[45,0,6]],true);
 const result=roadSupports([deck,crossing],()=>0);
 assert.equal(result.concrete.length,1);
 assert.ok(result.concrete[0].every(p=>p[0]===45));
});
test('ground-level pavement and tunnels need no supporting bank',()=>{
 const tunnel={...road([[0,0,5],[30,0,5]]),tunnel:true};
 assert.deepEqual(roadSupports([road([[0,0,.25],[30,0,.25]]),tunnel],()=>0),{earth:[],concrete:[],rails:[]});
});
test('banks leave intersecting roads at the same height clear',()=>{
 const main=road([[0,0,5],[30,0,5]]),side=road([[15,-30,5],[15,30,5]]);
 const result=roadSupports([main,side],()=>3.3);
 assert.equal(result.earth.length,0);
 assert.equal(result.rails.length,0);
});
