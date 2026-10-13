import fs from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const trip=dirname(fileURLToPath(import.meta.url));
const index=JSON.parse(fs.readFileSync(join(trip,'data/index.json')));
const locations=[];
for(const file of fs.readdirSync(join(trip,'data')).filter(x=>/^c\d+\.json$/.test(x))){
 const ch=JSON.parse(fs.readFileSync(join(trip,'data',file)));
 for(const p of ch.places) if(p[2]>=0.5&&Math.abs(p[3]||0)<(p[2]>=2?3000:900))locations.push([ch.s0+p[0],p[1],p[2]]);
}
locations.sort((a,b)=>a[0]-b[0]);
fs.writeFileSync(join(trip,'data/locations.json'),JSON.stringify(locations));
index.title='Our honeymoon road trip';
index.dry=false;
fs.writeFileSync(join(trip,'data/index.json'),JSON.stringify(index,null,2));
console.log(`${index.chunks.length}/${index.count} map chunks; ${locations.length} location captions; ${index.stops.length} honeymoon stops`);
