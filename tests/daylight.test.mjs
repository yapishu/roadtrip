import test from 'node:test';
import assert from 'node:assert/strict';
import {daylightState} from '../templates/daylight.js';
test('every weather sequence stays in daylight and varies with the session seed',()=>{
 const names=new Set();
 for(let seed=0;seed<30;seed++)for(let distance=0;distance<5e6;distance+=35000){
  const s=daylightState(seed,distance,2400);names.add(s.name);
  assert.ok(s.sun>=1.1&&s.sun<=2);assert.ok(s.ambient>=2&&s.ambient<=2.2);assert.ok(s.cover>=.1&&s.cover<=.94);
 }
 assert.equal(names.size,4);assert.notDeepEqual(daylightState(1,0),daylightState(2,0));
});
test('weather is stable at rest and continuous across route transitions',()=>{
 assert.deepEqual(daylightState(12,9999,40),daylightState(12,9999,40));
 for(let distance=0;distance<200000;distance+=100){
  const a=daylightState(12,distance,30),b=daylightState(12,distance+.1,30.1);
  for(const key of ['sun','ambient','cover'])assert.ok(Math.abs(a[key]-b[key])<.001);
 }
});
