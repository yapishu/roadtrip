import test from 'node:test';
import assert from 'node:assert/strict';
import {utilitySpans,guardrailRun} from '../templates/roadside-geometry.js';
const support=(id,x,z,kind='pole',height)=>({id,kind,points:[[x,0,z]],tags:height?{height}: {}});
test('power lines attach to pole crossarms, including different support heights and sloping ground',()=>{
 const features=[support('a',0,3),support('b',100,7,'tower','30 ft'),{kind:'line',points:[[0,0,3],[40,0,4],[100,0,7]],tags:{}}];
 const [span]=utilitySpans(features);
 assert.deepEqual(span.points[0],[0,0,11]);assert.deepEqual(span.points.at(-1),[100,0,7+30*.3048-.5]);
 for(const p of span.points.slice(1,-1))assert.ok(p[2]<11+(span.points.at(-1)[2]-11)*p[0]/100);
});
test('clipped power lines only draw spans between mapped supports',()=>{
 const features=[support('a',0,0),support('b',100,0),{kind:'line',points:[[-40,0,0],[0,0,0],[100,0,0],[140,0,0]]}];
 const spans=utilitySpans(features);assert.equal(spans.length,1);assert.equal(spans[0].points[0][0],0);assert.equal(spans[0].points.at(-1)[0],100);
});
test('guardrail ends descend below the shoulder and retain full height through the middle',()=>{
 const run=guardrailRun([[0,0,3],[40,0,5]]);
 assert.equal(run[0].height,-.18);assert.equal(run.at(-1).height,-.18);
 for(const r of run){assert.ok(Math.abs(r.point[2]-(3+r.at*.05))<1e-7);if(r.at>=8&&r.at<=32)assert.ok(Math.abs(r.height-.8)<1e-7);}
 for(let i=1;i<5;i++)assert.ok(run[i].height>run[i-1].height);
 const joined=guardrailRun([[0,0,3],[40,0,5]],{start:false,end:false});assert.ok(joined.every(r=>Math.abs(r.height-.8)<1e-7));
});
