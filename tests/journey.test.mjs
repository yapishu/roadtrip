import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test('a main stop at two adjoining scenic replacements remains at their shared boundary',()=>{
  const root=mkdtempSync(join(tmpdir(),'roadtrip-journey-'));
  const write=(path,value)=>{mkdirSync(join(root,...path.split('/').slice(0,-1)),{recursive:true});writeFileSync(join(root,path),JSON.stringify(value));};
  try{
    write('data/index.json',{total:1000,stops:[{name:'Start',at:0},{name:'Shared town',at:500},{name:'Finish',at:1000}]});
    for(const [id,replace,total]of [['mountains',[100,500],600],['canyon',[500,800],450]]){
      write(`detours/${id}/plan.json`,{name:id,stop:1,replace});
      write(`detours/${id}/route.json`,{total,stops:[{name:'Entry',at:0},{name:'Interior',at:total/2},{name:'Exit',at:total}]});
    }
    execFileSync(process.execPath,['scripts/build-journey.mjs',root]);
    const journey=JSON.parse(readFileSync(join(root,'journey.json')));
    assert.equal(journey.total,1350);
    assert.equal(journey.stops.filter(s=>s.name==='Shared town').length,1);
    assert.equal(journey.stops.find(s=>s.name==='Shared town').at,700);
    assert.equal(journey.segments[2].at,700);
    assert.equal(journey.segments[2].source,'detours/canyon');
  }finally{rmSync(root,{recursive:true,force:true});}
});
