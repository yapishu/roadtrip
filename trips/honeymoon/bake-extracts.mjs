import fs from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const trip=dirname(fileURLToPath(import.meta.url)),root=resolve(trip,'../..'),extracts=join(trip,'.cache/extracts'),merged=join(extracts,'merged');

const regions=['nevada','california','arizona','utah','colorado','new-mexico','texas'];
const count=JSON.parse(fs.readFileSync(join(trip,'data/index.json'))).count;
fs.mkdirSync(merged,{recursive:true});
function merge(from,to){
for(let c=from;c<=to;c++){
 const name=`c${String(c).padStart(4,'0')}.json`,buckets={osm:new Map(),landmarks:new Map(),skyline:new Map()};
 for(const region of regions){const file=join(extracts,region,name);if(!fs.existsSync(file))continue;const data=JSON.parse(fs.readFileSync(file));for(const group of Object.keys(buckets))for(const element of data[group].elements)buckets[group].set(`${element.type}:${element.id}`,element);}
 if(!buckets.osm.size)throw Error(`No OpenStreetMap data for chunk ${c}`);
 fs.writeFileSync(join(merged,name),JSON.stringify(Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,{elements:[...v.values()]}]))));
}
}
console.log('Source map merger ready');
const run=args=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd:root,stdio:'inherit'});p.on('exit',c=>c===0?resolve():reject(Error(`Exit ${c}`)));});
const wait=async condition=>{while(!condition())await new Promise(r=>setTimeout(r,2000));};
await wait(()=>regions.filter(r=>r!=='texas').every(r=>fs.existsSync(join(extracts,r,'complete.json'))));
merge(0,359);
for(const [from,to,land] of [[0,56,'farm'],[57,359,'desert']])await run(['scripts/bake.mjs','--trip',trip,'--osm-dir',merged,'--residential-lawns','--from-chunk',String(from),'--to-chunk',String(to),'--default-land',land]);
await wait(()=>fs.existsSync(join(extracts,'ready')));
merge(360,count-1);
for(const [from,to,land] of [[360,369,'desert'],[370,431,'grass']])await run(['scripts/bake.mjs','--trip',trip,'--osm-dir',merged,'--residential-lawns','--from-chunk',String(from),'--to-chunk',String(to),'--default-land',land]);
await run([join(trip,'prepare-viewer.mjs')]);
fs.writeFileSync(join(trip,'full-bake-complete'),'ready');
console.log('Full road-trip map is ready');
