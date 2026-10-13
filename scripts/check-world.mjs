// Inspect representative driving frames and record measurable rendering failures.
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]),url=process.argv[3]||'http://127.0.0.1:8088/',out=join(root,'check-world');mkdirSync(out,{recursive:true});
const journey=await fetch(new URL('journey.json',url)).then(r=>r.json());
const toGlobal=s=>{const part=journey.segments.find(p=>!p.source&&s>=p.start&&s<=p.end);return part?part.at+s-part.start:null;};
const targets=journey.stops.map(s=>({name:s.name,at:Math.max(0,s.at-70)}));
for(const part of journey.segments)if(part.source)targets.push({name:part.source+' · canyon road',at:part.at+part.length*.42});
for(const km of [40.17,86.435,108.605,474.9,477.95,480.02,482.37,3246.455,1131,2142.77,2147.61,2154.15,2158.99,2160,3831.63]){const at=toGlobal(km*1000);if(at!==null)targets.push({name:'Road profile '+km,at});}
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message));
// Mark the actual sky only during the pixel audit; screenshots retain daylight.
await page.route('**/world.js',async route=>{
 const response=await route.fetch(),source=await response.text(),anchor='return {get W(){return W;}';
 if(!source.includes(anchor))throw Error('World inspection entry point is missing');
 const body=source.replace(anchor,`return {skyPixels(){
   const u=scene.children.find(o=>o.material?.uniforms?.cloudMap).material.uniforms,names=['top','horizon','cloud','shade'],saved=names.map(k=>u[k].value.clone()),cover=u.cover.value;
   for(const k of names)u[k].value.set('#ff00ff');u.cover.value=0;
   renderer.render(scene,camera);ctx.drawImage(renderer.domElement,0,0);
   const p=ctx.getImageData(0,0,W,H),colors=new Set();let skyLow=0;
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,r=p.data[i],g=p.data[i+1],b=p.data[i+2];colors.add((r<<16)|(g<<8)|b);if(y>H*.75&&r===255&&g===0&&b===255)skyLow++;}
   names.forEach((k,i)=>u[k].value.copy(saved[i]));u.cover.value=cover;renderer.render(scene,camera);ctx.drawImage(renderer.domElement,0,0);
   return {colors:colors.size,skyLow};
 },get W(){return W;}`);
 await route.fulfill({response,body});
});
page.on('console',message=>{if(/Shader Error|INVALID_OPERATION/.test(message.text()))errors.push(message.text());});
await page.goto(new URL('?world=1&paused=1&display=1',url).href);await page.waitForFunction(()=>window.__trip,{timeout:60000});
for(const [i,target]of targets.entries()){
 try{const info=await page.evaluate(km=>window.__trip.goto(km),target.at/1000);const pixels=await page.evaluate(()=>__trip.road.skyPixels());
 const name=`frame-${String(i).padStart(2,'0')}.png`;await page.screenshot({path:join(out,name)});frames.push({...target,...info,...pixels,file:name});console.log(i,target.name,JSON.stringify({triangles:info.stats.triangles,skyLow:pixels.skyLow,failures:info.stats.failures}));}
 catch(e){errors.push(target.name+': '+e.message);console.log('FAILED',target.name,e.message);}
}
await browser.close();writeFileSync(join(out,'report.json'),JSON.stringify({frames,errors,checked:new Date().toISOString(),coverage:'Named stops, park interiors, selected road-profile corrections'},null,2));
const issues=frames.filter(f=>f.skyLow>2||f.colors<24||f.stats.failures.length);console.log(`${frames.length} frames; ${issues.length} flagged frames; ${errors.length} runtime errors`);if(issues.length||errors.length)process.exitCode=1;
