import test from 'node:test';
import assert from 'node:assert/strict';
import {planAmbient,roadClearance,scheduleAmbient} from '../templates/ambient-plan.js';
import {groundHeight} from '../templates/road-grade.js';
const near={x0:-20,y0:-200,cell:10,w:1005,h:41,scale:.1,offset:-500};
const route=Array.from({length:2001},(_,i)=>[i*5,i*5,0,100,8,'secondary','',0,0]);
const roads=[{width:8,points:[[0,0,100],[10000,0,100]]}];
const d={s0:0,len:10000,near,route,roads,buildings:[]},ground=new Uint16Array(near.w*near.h).fill(6000);
const groundAt=(x,y)=>groundHeight(near,ground,x,y);
const events=seed=>Array.from({length:10},(_,i)=>({s:500+i*900,seed:`${seed}:encounter:${i}`}));
const plans=Array.from({length:20},(_,seed)=>planAmbient(d,groundAt,events(seed)));
test('global encounter candidates are five to ten miles apart',()=>{
  for(let seed=0;seed<20;seed++){let previous=0;const scheduled=scheduleAmbient(1609344,seed);assert.ok(scheduled.length>100&&scheduled.length<160);for(const event of scheduled){const miles=(event.at-previous)/1609.344;assert.ok(miles>=5&&miles<=10);previous=event.at;}}
});
test('encounters stay stable while streaming and vary between seeds',()=>{
  assert.deepEqual(plans[0],planAmbient(d,groundAt,events(0)));assert.notDeepEqual(plans[0],plans[1]);
  assert.ok(plans.flat().some(e=>e.kind==='birds'));assert.ok(plans.flat().some(e=>e.kind==='deer'));assert.ok(plans.flat().some(e=>e.kind==='hare'));
});
test('wildlife stays on the ground outside every road and building footprint',()=>{
  for(const plan of plans)for(const e of plan.filter(e=>e.kind!=='birds')){
    assert.ok(Math.abs(e.z-100)<1e-9);assert.ok(roadClearance(roads,e.x,e.y)>=6);
    const buildings=[{points:[[e.x-15,e.y-15],[e.x+15,e.y-15],[e.x+15,e.y+15],[e.x-15,e.y+15]]}];
    assert.ok(!planAmbient({...d,buildings},groundAt,events(plans.indexOf(plan))).some(v=>v.s===e.s));
    const crossroad={width:8,points:[[e.x-50,e.y,100],[e.x+50,e.y,100]]};
    assert.ok(!planAmbient({...d,roads:[...roads,crossroad]},groundAt,events(plans.indexOf(plan))).some(v=>v.s===e.s));
  }
});
test('bridge and tunnel routes do not place roadside encounters',()=>{
  for(const flag of [7,8]){const structureRoute=route.map(p=>{const q=[...p];q[flag]=1;return q;});assert.deepEqual(planAmbient({...d,route:structureRoute},groundAt,events(0)),[]);}
});
test('unsafe ground elevations prevent wildlife placement',()=>{
  const low=new Uint16Array(ground.length).fill(5000);
  assert.ok(planAmbient(d,(x,y)=>groundHeight(near,low,x,y),events(0)).every(e=>e.kind==='birds'));
});
