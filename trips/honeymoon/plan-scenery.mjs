import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {RECIPE,FACADES} from '../../scripts/kit.mjs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const trip=dirname(fileURLToPath(import.meta.url)),root=resolve(trip,'../..');
export const themes=[
'california|0|California Bay Area and San Joaquin Valley: light stucco ranch houses, tile roofs, modest downtown brick shops, farm buildings',
'canyons|570|Mojave Desert and Colorado Plateau: low sand-colored stucco buildings, roadside motels, flat-roofed shops, pine-covered highlands and desert towns',
'newmexico|2940|New Mexico: warm adobe and pale stucco houses, flat parapets, wooden lintels, brick railroad-town storefronts',
 'texas|3770|West and North Texas: low red-brick ranch houses, limestone and red-brick main-street shops, corrugated farm and industrial buildings'
];
export const subjects={
'california:house':'one low rectangular modern American single-story house, pale gray horizontal wooden siding, a dark flat roof with wide eaves, a red front door and three broad white-framed windows, only the building|one plain 1960s American single-story tract house with pale blue horizontal siding, broad low asphalt roof, white garage door on the left and three wide rectangular windows|one plain single-story beige stucco California ranch home with a wide low red tile hip roof, two wide picture windows and a brown garage door',
'california:shop':'one low red-brick California main-street shop with broad storefront windows and a plain cream awning|one two-story cream stucco California commercial building with a blank blue storefront awning',
'california:terrace':'one two-story pale stucco California townhouse with square windows, a red tiled roof and a small garage door',
'california:tree':'one mature deciduous oak tree, one straight brown trunk ending in a flat cut, dense rounded green canopy, no exposed roots, no soil, no stones|one California fan palm tree with a tall straight trunk and a compact green crown',
'california:bush':'one low spreading gray-green sagebrush bush with many small leaves and thin woody branches, no container, no pot',
'california:farm':'one California farm barn with pale weathered timber siding, a low green metal roof and a broad door',
'canyons:house':'one low sandy-stucco desert ranch house with a brown shallow pitched roof and three square windows|one low pale peach stucco Southwestern house with a flat parapet roof and turquoise front door|one cream stucco desert bungalow with a low red tile roof and a shaded porch',
'canyons:shop':'one low sand-colored roadside motel facade with four identical room doors, a flat roof and blank sign|one single-story tan brick desert-town storefront with a flat parapet, broad windows and blank red awning',
'canyons:terrace':'one two-story tan stucco desert-town row house with flat parapet and four square windows',
'canyons:apartment':'one rectangular six-story Nevada apartment building, pale stucco walls and regular dark windows, flat roof',
'canyons:tower':'one tall rectangular Nevada hotel tower, cream vertical strips and regular blue glass window rows, flat roof, no signage',
'canyons:tree':'one mature pine tree with a straight brown trunk and a full conical dark green crown, trunk ending in a flat cut, no exposed roots, no soil, no stones|one Utah juniper tree with an irregular green crown and gnarled single trunk',
'canyons:bush':'one isolated compact desert sagebrush shrub, muted olive leaves and woody stems',
'canyons:civic':'one low sandstone national park visitor building, broad rectangular windows and a low brown gabled roof',
'canyons:church':'one simple cream stucco southwestern church with a square bell tower and arched entrance',
'newmexico:house':'one low terracotta adobe New Mexico house with rounded flat parapets, blue door and three square windows|one pale sand-colored adobe house with exposed wooden roof beams and a red front door|one single-story warm pink stucco house with a low brown pitched roof and white windows',
'newmexico:shop':'one single-story tan adobe storefront with wooden lintels, flat parapet and a blank turquoise sign|one two-story warm red-brick railroad-town shop with rectangular storefront windows and cream trim',
'newmexico:terrace':'one two-story warm tan stucco New Mexico townhouse with a flat parapet and recessed blue front door',
'newmexico:tree':'one New Mexico cottonwood tree, broad green crown and thick pale trunk|one pinyon pine tree with rounded dark green crown and short brown trunk',
'newmexico:bush':'one small New Mexico sagebrush shrub with muted gray-green leaves',
'newmexico:church':'one New Mexico adobe church with two small square bell towers, rounded parapets and wooden arched entrance',
'newmexico:farm':'one simple weathered New Mexico ranch barn with a rust-red metal gable roof and wide wooden doors',
 'texas:house':'one single-story red-brick Texas ranch house with a low gray shingle roof, white windows and a recessed front door|one single-story cream-brick Texas house with a low brown gable roof and green front door|one pale limestone Texas ranch house with wide windows and a low charcoal roof',
 'texas:shop':'one two-story red-brick Texas main-street storefront with a cream parapet and a broad blank awning|one low limestone Texas shop with rectangular display windows and a flat parapet',
 'texas:terrace':'one two-story red-brick Texas townhouse with white window trim and a gray gabled roof',
 'texas:tree':'one mature deciduous oak tree with a wide rounded leafy green crown and one thick brown trunk ending in a flat cut, no exposed roots, no soil, no stones|one plains cottonwood tree with bright green crown and pale trunk',
 'texas:bush':'one small rounded green Texas roadside shrub',
 'texas:farm':'one broad weathered timber Texas barn with a corrugated red metal gabled roof and a central double door',
 'industrial':'one single-story rectangular corrugated-metal American warehouse with a shallow pitched roof, a broad roll-up door and two small windows',
 'street':'one plain American roadside letter mailbox, a gray horizontal rectangular metal box with a rounded top and small red flag, on one straight wooden post'
};
const args=[root+'/scripts/plan-art.mjs','--trip',trip,'--detail','detailed','--no-landmarks',...themes.flatMap(t=>['--theme',t]),...Object.entries(subjects).flatMap(([k,v])=>['--subject',k+'='+v])];
if (process.argv[1] === fileURLToPath(import.meta.url)) {
 const previous=JSON.parse(fs.readFileSync(trip+'/art/plan.json'));
 const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.status)process.exit(result.status);
 const file=trip+'/art/plan.json',plan=JSON.parse(fs.readFileSync(file));
 for(const job of plan.jobs){
  if(job.role==='house'){job.hm=4.5;job.width=192;job.height=112;}
  if(job.kind==='facade')job.negative='medieval, fantasy, Tudor, European cottage, half timber, steep roof, ornate, dormer windows, vines, plants, trees, garden, furniture';
 }
 const old=new Map(previous.jobs.filter(j=>j.role!=='landmark').map(j=>[j.name,j]));
 plan.jobs=plan.jobs.map(j=>old.get(j.name)||j);
 for(const j of old.values())if(!plan.jobs.some(n=>n.name===j.name))plan.jobs.push(j);
 const index=JSON.parse(fs.readFileSync(trip+'/data/index.json'));
 for(let i=0;i<plan.themes.length;i++){
  const t=plan.themes[i],next=plan.themes[i+1]?.from??Infinity;
  if(!index.chunks.some(c=>c.s0>=t.from&&c.s0<next&&c.maxH>40))continue;
  for(let v=1;v<=3;v++){
   const name=t.id+'-tower-'+v;if(plan.jobs.some(j=>j.name===name))continue;
   const f=FACADES.tower,subject='one tall rectangular modern American office or hotel tower, '+['pale stone walls with regular blue rectangular windows','dark blue glass facade with narrow cream vertical strips','warm beige facade with many rows of square dark windows'][v-1]+', a flat roof, no signage';
   plan.jobs.push({name,seed:parseInt(createHash('sha1').update(name).digest('hex').slice(0,7),16),palette:root+'/templates/palette.png',role:'tower',theme:t.id,kind:'facade',width:f.w,height:f.h,hm:f.hm,prompt:RECIPE.facade(subject),negative:'sprite sheet, grid, collection, multiple buildings, angled, isometric, scenery, text, logo'});
  }
 }
 const landmarkSubjects={
  Q27768421:'one very wide low oval modern stadium, rounded black glass exterior, narrow silver horizontal bands, shallow domed roof, a single continuous building without any logos or writing',
  Q5594348:'one long dark brown log railway depot, a taller two-story center section with a broad green shingle gable roof, low log wings on both sides, deep eaves and square wooden windows, no words or logos',
  Q3799756:'one broad cream stucco former movie theater facade, a stepped parapet, recessed glass entrance and a projecting rectangular blank marquee, no words or logos',
  Q16850642:'one red brick Gothic church facade, cream stone trim, pointed arch windows, a tall central pointed arch window over dark wooden double doors and a square crenellated brick bell tower, no words'
 };
 const landmarks=JSON.parse(fs.readFileSync(trip+'/data/landmarks.json'));
 for(const [qid,subject]of Object.entries(landmarkSubjects)){
  const lm=landmarks.find(l=>l.qid===qid);if(!lm)continue;
  const name='lm-'+qid,theme=[...plan.themes].reverse().find(t=>t.from<=lm.s)?.id||plan.themes[0].id;
  plan.landmarks[qid]=name;
  plan.jobs.push({name,seed:parseInt(createHash('sha1').update(name).digest('hex').slice(0,7),16),palette:root+'/templates/palette.png',role:'landmark',theme,kind:'landmark',width:256,height:160,hm:lm.h,qid,label:lm.name,prompt:RECIPE.landmark(subject),negative:'sprite sheet, grid, collection, multiple buildings, scenery, ground, landscape, text, logo, signage'});
 }
 fs.writeFileSync(file,JSON.stringify(plan,null,2));
}
