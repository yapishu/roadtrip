// Assemble one continuous itinerary from the main route and scenic park drives.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
const trip=resolve(process.argv[2]),main=JSON.parse(readFileSync(join(trip,'data/index.json')));
const parks=readdirSync(join(trip,'parks')).map(id=>{const root=join(trip,'parks',id),plan=JSON.parse(readFileSync(join(root,'plan.json'))),route=JSON.parse(readFileSync(join(root,'route.json')));return {id,plan,route,at:main.stops[plan.stop].at};}).sort((a,b)=>a.at-b.at);
let cursor=0,total=0;const segments=[],stops=[],sources={'':{total:main.total,stops:main.stops}};
function add(source,start,end){if(end<=start)return;segments.push({source,start,end,at:total,length:end-start});total+=end-start;}
for(const park of parks){add('',cursor,park.at);const source='parks/'+park.id;sources[source]={total:park.route.total,name:park.plan.name,themeAt:park.at,stops:park.route.stops};const at=total;add(source,0,park.route.total);for(const mark of park.route.stops.slice(1,-1))stops.push({...mark,at:at+mark.at});cursor=park.at;}
add('',cursor,main.total);
for(const stop of main.stops){const before=parks.filter(p=>p.at<stop.at).reduce((sum,p)=>sum+p.route.total,0);stops.push({...stop,at:stop.at+before});}
stops.sort((a,b)=>a.at-b.at);
writeFileSync(join(trip,'journey.json'),JSON.stringify({total,segments,sources,stops}));
console.log(`${(total/1000).toFixed(2)} km, ${parks.length} park drives, ${stops.length} stops`);
