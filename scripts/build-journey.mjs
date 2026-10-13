// Assemble one continuous itinerary from the main route and scenic park drives.
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
const trip=resolve(process.argv[2]),main=JSON.parse(readFileSync(join(trip,'data/index.json')));
const saved=existsSync(join(trip,'journey.json'))?JSON.parse(readFileSync(join(trip,'journey.json'))).sources:{};
const visits=[];
for(const directory of ['parks','detours']){
  if(!existsSync(join(trip,directory)))continue;
  for(const id of readdirSync(join(trip,directory))){const root=join(trip,directory,id),plan=JSON.parse(readFileSync(join(root,'plan.json'))),route=JSON.parse(readFileSync(join(root,'route.json'))),at=main.stops[plan.stop].at;
    visits.push({source:directory+'/'+id,plan,route,start:plan.replace?.[0]??at,end:plan.replace?.[1]??at,themeAt:at});}
}
visits.sort((a,b)=>a.start-b.start);
let cursor=0,total=0;const segments=[],stops=[],sources={'':{...saved[''],total:main.total,stops:main.stops}};
function add(source,start,end){if(end<=start)return;segments.push({source,start,end,at:total,length:end-start});total+=end-start;}
for(const visit of visits){if(visit.start<cursor)throw Error('Overlapping scenic visits');add('',cursor,visit.start);const {source,route,plan}=visit;sources[source]={...saved[source],total:route.total,name:plan.name,themeAt:visit.themeAt,stops:route.stops,vegetation:plan.vegetation,captions:plan.captions};const at=total;visit.at=at;if(plan.entryStop)stops.push({name:plan.entryStop,at});add(source,0,route.total);for(const mark of route.stops.slice(1,-1))stops.push({...mark,at:at+mark.at});cursor=visit.end;}
add('',cursor,main.total);
for(const stop of main.stops){
  if(visits.some(v=>v.plan.omitStops?.includes(stop.name)&&stop.at>v.start&&stop.at<v.end))continue;
  const part=segments.find(p=>!p.source&&stop.at>=p.start&&stop.at<=p.end);
  const boundary=visits.find(v=>stop.at===v.start||stop.at===v.end);
  if(!part&&!boundary)throw Error(`Stop inside replaced route: ${stop.name}`);
  const at=part?part.at+stop.at-part.start:boundary.at+(stop.at===boundary.end?boundary.route.total:0);
  stops.push({...stop,at});
}
stops.sort((a,b)=>a.at-b.at);
writeFileSync(join(trip,'journey.json'),JSON.stringify({total,segments,sources,stops}));
console.log(`${(total/1000).toFixed(2)} km, ${visits.length} scenic drives, ${stops.length} stops`);
