import test from 'node:test';
import assert from 'node:assert/strict';
import {roofProfile,roofPolygons,frontage,streetIndex,facadeFloors} from '../templates/building-shapes.js';
const building=(extra={})=>({points:[[0,0],[20,0],[20,10],[0,10],[0,0]],holes:[],base:100,height:6,roof:'gabled',roofHeight:2,...extra});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const area=ring=>Math.abs(ring.reduce((n,p,i)=>{const q=ring[(i+1)%ring.length];return n+p[0]*q[1]-q[0]*p[1];},0)/2);
test('hipped roofs slope down at both ends while gables retain their end peaks',()=>{
  const gable=roofProfile(building()),hip=roofProfile(building({roof:'hipped'}));
  near(gable.top([0,5]),106);near(hip.top([0,5]),104);near(hip.top([10,5]),106);
  for(const p of [[0,0],[20,0],[20,10],[0,10]])near(hip.top(p),104);
});
test('roof plane partitions cover the footprint without diagonal peaks or gaps',()=>{
  const profile=roofProfile(building({roof:'hipped'}));
  const triangles=[[[0,0],[20,0],[20,10]],[[0,0],[20,10],[0,10]]];
  const faces=triangles.flatMap(t=>roofPolygons(t,profile));
  near(faces.reduce((sum,f)=>sum+area(f),0),200);
  for(const face of faces)for(const p of face)assert.ok(profile.top(p)>=104-1e-7&&profile.top(p)<=106+1e-7);
});
test('mapped roof direction describes slope and across rotates the ridge',()=>{
  const across=roofProfile(building({roofOrientation:'across'}));
  near(across.top([10,0]),106);near(across.top([0,5]),104);
  const east=roofProfile(building({roof:'skillion',roofDirection:'E'}));
  near(east.top([0,5]),106);near(east.top([20,5]),104);
  const steep=roofProfile(building({height:10,roofHeight:6}));near(steep.eaves,104);near(steep.top([10,5]),110);
});
test('courtyards retain a flat roof and minimum heights leave wall clearance',()=>{
  const profile=roofProfile(building({holes:[[[8,3],[12,3],[12,7],[8,7],[8,3]]]}));
  assert.equal(profile.rise,0);near(profile.eaves,106);
  const elevated=roofProfile(building({minHeight:5}));assert.ok(elevated.eaves>105);
});
test('tall one-storey shops keep one floor while mapped levels take precedence',()=>{
  const shop=building({height:5.5,roof:'flat'});
  assert.equal(facadeFloors(shop,roofProfile(shop)),1);
  const mapped={...shop,levels:2};assert.equal(facadeFloors(mapped,roofProfile(mapped)),2);
  const part=building({height:16,levels:5,minLevel:2,minHeight:6.2});assert.equal(facadeFloors(part,roofProfile(part)),3);
});
test('storefront selection follows the outward street face in either winding',()=>{
  const b=building(),streets=streetIndex([{kind:'residential',points:[[-20,-8],[40,-8]]}]);
  assert.deepEqual(frontage(b,streets),[0]);
  const reversed={...b,points:[...b.points].reverse()};assert.deepEqual(frontage(reversed,streets),[3]);
  assert.deepEqual(frontage(b,streetIndex([{kind:'motorway',points:[[-20,-8],[40,-8]]}])), []);
});
test('main street takes precedence over a nearby service alley',()=>{
  const streets=streetIndex([{kind:'primary',points:[[-20,-10],[40,-10]]},{kind:'service',points:[[-20,15],[40,15]]}]);
  assert.equal(frontage(building({kind:'house'}),streets)[0],0);
  assert.deepEqual(frontage(building(),streetIndex([{kind:'trunk',points:[[-20,-8],[40,-8]]}])),[0]);
});
