// Inspect representative driving frames and record measurable rendering failures.
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]),url=process.argv[3]||'http://127.0.0.1:8088/',out=join(root,'check-world');mkdirSync(out,{recursive:true});
const journey=await fetch(new URL('journey.json',url)).then(r=>r.json());
const toGlobal=s=>{const part=journey.segments.find(p=>!p.source&&s>=p.start&&s<=p.end);return part.at+s-part.start;};
const targets=journey.stops.map(s=>({name:s.name,at:Math.max(0,s.at-70)}));
for(const part of journey.segments)if(part.source)targets.push({name:part.source+' · canyon road',at:part.at+part.length*.42});
for(const km of [1131,2142.77,2147.61,2154.15,2158.99,2160,3831.63])targets.push({name:'Road profile '+km,at:toGlobal(km*1000)});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[],frames=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(new URL('?world=1&paused=1&display=1',url).href);await page.waitForFunction(()=>window.__trip,{timeout:60000});
for(const [i,target]of targets.entries()){
 try{const info=await page.evaluate(km=>window.__trip.goto(km),target.at/1000);const pixels=await page.evaluate(()=>{const c=document.querySelector('#c'),p=c.getContext('2d').getImageData(0,0,c.width,c.height),colors=new Set();let skyLow=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4,r=p.data[i],g=p.data[i+1],b=p.data[i+2];colors.add((r<<16)|(g<<8)|b);if(y>c.height*.75&&r===170&&g===200&&b===220)skyLow++;}return {colors:colors.size,skyLow};});
 const name=`frame-${String(i).padStart(2,'0')}.png`;await page.screenshot({path:join(out,name)});frames.push({...target,...info,...pixels,file:name});console.log(i,target.name,JSON.stringify({triangles:info.stats.triangles,skyLow:pixels.skyLow,failures:info.stats.failures}));}
 catch(e){errors.push(target.name+': '+e.message);console.log('FAILED',target.name,e.message);}
}
await browser.close();writeFileSync(join(out,'report.json'),JSON.stringify({frames,errors,checked:new Date().toISOString(),coverage:'Named stops, park interiors, selected road-profile corrections'},null,2));
const issues=frames.filter(f=>f.skyLow>2||f.colors<24||f.stats.failures.length);console.log(`${frames.length} frames; ${issues.length} flagged frames; ${errors.length} runtime errors`);if(issues.length||errors.length)process.exitCode=1;
