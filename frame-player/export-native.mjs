import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {createCanvas,loadImage} from '@napi-rs/canvas';

const root=path.resolve(process.env.SOURCE_DIR||fileURLToPath(new URL('../trips/honeymoon/',import.meta.url))),out=path.resolve(process.env.NATIVE_SCENE_DIR||'native-scene');
await fs.mkdir(out,{recursive:true});await fs.mkdir(out+'/textures',{recursive:true});await fs.mkdir(out+'/chunks',{recursive:true});
const grids=new Map();
globalThis.document={createElement:()=>createCanvas(1,1)};
// Scene requests resolve through local file I/O.
globalThis.fetch=async url=>{
 const rel=String(url),file=path.join(root,rel);
 try{
  const bytes=await fs.readFile(file);
  return {ok:true,status:200,json:async()=>{
   const obj=JSON.parse(bytes);
   if(/\/c\d{4}\.json$/.test(rel))for(const key of ['near','far']){
    const g=obj[key],factor=key==='near'?4:4;
    grids.set(path.posix.join(path.posix.dirname(rel),g.file),{...g,factor});
    g.textureBounds={...g};g.w=Math.floor((g.w-1)/factor)+1;g.h=Math.floor((g.h-1)/factor)+1;g.cell*=factor;
   }
   return obj;
  },arrayBuffer:async()=>{
   const grid=grids.get(rel);if(!grid)return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length);
   const source=new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.length/2),w=Math.floor((grid.w-1)/grid.factor)+1,h=Math.floor((grid.h-1)/grid.factor)+1,target=new Uint16Array(w*h);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++)target[y*w+x]=source[y*grid.factor*grid.w+x*grid.factor];return target.buffer;
  }};
 }catch(e){if(e.code!=='ENOENT')throw e;return {ok:false,status:404,json:async()=>null};}
};
const imageCache=new Map();
globalThis.frameLoadTexture=async file=>{
 if(!imageCache.has(file))imageCache.set(file,loadImage(path.join(root,file)));
 const texture=new THREE.Texture(await imageCache.get(file));texture.userData.file=file;texture.needsUpdate=true;return texture;
};
let source=await fs.readFile('src/world.js','utf8');
source=source.replace(/  const renderer=.*\n/,'  const renderer={setSize(){},setPixelRatio(){},render(){},dispose(){},info:{render:{},memory:{}}};\n');
source=source.replace("const mat=material('#ffffff',{map:texture});","const mat=material('#ffffff',{map:texture});mat.userData.terrain=true;");
source=source.replace('new THREE.TextureLoader()','{loadAsync:globalThis.frameLoadTexture}');
source=source.replace('return {get W()',"return {exportChunk:async(source,c)=>{await load(source,c);await pending.get(source+':'+c);return chunks.get(source+':'+c);},clearChunks:()=>{for(const [key,ch]of chunks){scene.remove(ch.group);ch.group.traverse(o=>o.geometry?.dispose());chunks.delete(key);}},get W()");
await fs.writeFile('src/native-world.js',source);
const {createRoad}=await import('./src/native-world.js?time='+Date.now());
const road=await createRoad(createCanvas(342,192),{width:342,height:192,skySeed:7,ambientSeed:11});
const journey=JSON.parse(await fs.readFile(root+'/journey.json'));
await fs.writeFile(out+'/journey.json',JSON.stringify(journey));
const textureNames=new Map();
async function textureName(texture){
 if(!texture)return '';
 const file=texture.userData.file||crypto.createHash('sha256').update(texture.image.toBuffer('image/png')).digest('hex')+'.png';
 if(textureNames.has(file))return textureNames.get(file);
 const name=crypto.createHash('sha256').update(file).digest('hex').slice(0,20)+'.png';
 const image=texture.image,scale=Math.min(1,1024/Math.max(image.width,image.height));
 const canvas=createCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
 await fs.writeFile(out+'/textures/'+name,canvas.toBuffer('image/png'));textureNames.set(file,name);return name;
}
const jobs=[];
for(const segment of journey.segments){
 for(let c=Math.floor(segment.start/10000);c<=Math.floor((segment.end-.001)/10000);c++){
  const id=(segment.source||'main').replaceAll('/','_')+'_'+String(c).padStart(4,'0');
  if(!jobs.some(j=>j.id===id))jobs.push({source:segment.source,c,id});
 }
}
await fs.writeFile(out+'/jobs.json',JSON.stringify(jobs));
const selection=process.argv[2];const selected=selection?jobs.filter(j=>j.id===selection):jobs.filter((j,i)=>i%Number(process.env.EXPORT_SHARDS||1)===Number(process.env.EXPORT_SHARD||0));
function f32(values){return Buffer.from(new Float32Array(values).buffer);}
function u32(values){return Buffer.from(new Uint32Array(values).buffer);}
for(const [jobIndex,job]of selected.entries()){
 const started=Date.now(),filename=out+'/chunks/'+job.id+'.frm.gz';
 if(!selection&&await fs.stat(filename).catch(()=>null)){console.log('cached',job.id);continue;}
 console.log('building',jobIndex+1,selected.length,job.id);
 const chunk=await road.exportChunk(job.source,job.c);if(!chunk)throw Error('Scene compilation failed: '+job.id);
 const group=chunk.group;group.updateMatrixWorld(true);
 const materialList=[],materialMap=new Map(),canonicalMaterials=new Map(),buckets=new Map();
 const position=new THREE.Vector3(),normal=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
 const corridor=new Set();for(const p of chunk.d.route){const x=Math.floor(p[1]/512),z=Math.floor(-p[2]/512);for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++)corridor.add((x+dx)+':'+(z+dz));}
 const objects=[];group.traverse(o=>{if(o.isMesh||o.isLineSegments)objects.push(o);});
 for(const object of objects){
  const geo=object.geometry,mat=object.material;if(Array.isArray(mat)||mat.isShaderMaterial)throw Error('Unsupported scene material in '+job.id);
  let mi=materialMap.get(mat);
  if(mi===undefined){const properties={texture:await textureName(mat.map),color:mat.color?.toArray()||[1,1,1],unlit:!!mat.isMeshBasicMaterial,alpha:mat.alphaTest||0,double:mat.side===THREE.DoubleSide,offset:mat.polygonOffset?mat.polygonOffsetFactor:0,lines:!!object.isLineSegments,opacity:mat.opacity??1,range:mat.userData.terrain?45000:mat.alphaTest?900:1800};const canonical=JSON.stringify(properties);mi=canonicalMaterials.get(canonical);if(mi===undefined){mi=materialList.length;materialList.push(properties);canonicalMaterials.set(canonical,mi);}materialMap.set(mat,mi);}
  const p=geo.attributes.position,n=geo.attributes.normal,uv=geo.attributes.uv,col=geo.attributes.color,index=geo.index,step=object.isLineSegments?2:3,count=index?index.count:p.count;
  normalMatrix.getNormalMatrix(object.matrixWorld);
  for(let face=0;face<count;face+=step){
   const vertices=[];let cx=0,cz=0;
   for(let v=0;v<step;v++){
    const i=index?index.getX(face+v):face+v;position.fromBufferAttribute(p,i).applyMatrix4(object.matrixWorld);normal.set(0,1,0);if(n)normal.fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize();
    cx+=position.x;cz+=position.z;
    vertices.push([position.x,position.y,position.z,normal.x,normal.y,normal.z,uv?uv.getX(i):0,uv?uv.getY(i):0,col?col.getX(i):1,col?col.getY(i):1,col?col.getZ(i):1]);
   }
   if(!mat.userData.terrain&&!corridor.has(Math.floor(cx/step/512)+':'+Math.floor(cz/step/512)))continue;
   const batchSize=mat.userData.terrain?4096:512;const key=mi+':'+Math.floor(cx/step/batchSize)+':'+Math.floor(cz/step/batchSize);let bucket=buckets.get(key);if(bucket&&bucket.vertices.length>60000){buckets.set(key+':'+buckets.size,bucket);buckets.delete(key);bucket=null;}
   if(!bucket){bucket={mi,vertices:[],indices:[],lookup:new Map(),min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};buckets.set(key,bucket);}
   for(const v of vertices){
    const key=v.map((x,i)=>Math.round(x*(i<3?1000:10000))).join(',');let ix=bucket.lookup.get(key);
    if(ix===undefined){ix=bucket.vertices.length;bucket.lookup.set(key,ix);bucket.vertices.push(v);for(let k=0;k<3;k++){bucket.min[k]=Math.min(bucket.min[k],v[k]);bucket.max[k]=Math.max(bucket.max[k],v[k]);}}
    bucket.indices.push(ix);
   }
  }
 }
 const materials=Buffer.from(JSON.stringify(materialList)),route=chunk.d.route;
 const pieces=[Buffer.from('FRM4'),u32([materials.length,buckets.size,route.length]),materials];
 for(const p of route)pieces.push(f32([p[0],p[1],p[2],p[3],p[4]]));
 let triangles=0,verts=0;
 for(const b of buckets.values()){
  if(b.vertices.length>65535)throw Error('Batch exceeds 16-bit vertex indices: '+job.id);
  const center=b.min.map((v,i)=>(v+b.max[i])/2),radius=Math.hypot(...b.max.map((v,i)=>(v-b.min[i])/2));
  let lod1=b.indices.length,lod2=b.indices.length;
  if(materialList[b.mi].range<45000&&!materialList[b.mi].lines){const faces=[];for(let i=0;i<b.indices.length;i+=3){const ids=b.indices.slice(i,i+3),[a,c,d]=ids.map(k=>b.vertices[k]),u=c.slice(0,3).map((x,k)=>x-a[k]),v=d.slice(0,3).map((x,k)=>x-a[k]);const area=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;faces.push({ids,area});}faces.sort((a,b)=>b.area-a.area);b.indices=faces.flatMap(f=>f.ids);lod1=faces.filter(f=>f.area>=1).length*3;lod2=faces.filter(f=>f.area>=8).length*3;}
  const scales=b.max.map((v,i)=>Math.max(.000001,(v-b.min[i])/65535));
  pieces.push(u32([b.mi,b.vertices.length,b.indices.length,lod1,lod2]),f32([...center,radius,...b.min,...scales]));
  const bytes=Buffer.alloc(b.vertices.length*20);
  for(let i=0;i<b.vertices.length;i++){const v=b.vertices[i],at=i*20,mat=materialList[b.mi];for(let k=0;k<3;k++)bytes.writeUInt16LE(Math.max(0,Math.min(65535,Math.round((v[k]-b.min[k])/scales[k]))),at+k*2);const sun=Math.max(0,-.46*v[3]+.77*v[4]+.31*v[5]),hemi=v[4]*.5+.5;for(let k=0;k<3;k++){const light=mat.unlit?1:[.17,.14,.10][k]+([.70,.77,.84][k]-[.17,.14,.10][k])*hemi+[.55,.51,.44][k]*sun;const srgb=Math.pow(Math.max(0,mat.color[k]*v[k+8]*light),1/2.2);bytes.writeUInt8(Math.round(Math.min(1,srgb)*255),at+8+k);}bytes[at+11]=255;bytes.writeFloatLE(v[6],at+12);bytes.writeFloatLE(v[7],at+16);}
  pieces.push(bytes,Buffer.from(new Uint16Array(b.indices).buffer));triangles+=b.indices.length/3;verts+=b.vertices.length;
 }
 await fs.writeFile(filename+".tmp",gzipSync(Buffer.concat(pieces),{level:3}));await fs.rename(filename+".tmp",filename);
 console.log('compiled',job.id,JSON.stringify({seconds:(Date.now()-started)/1000,meshes:buckets.size,vertices:verts,triangles,bytes:pieces.reduce((n,p)=>n+p.length,0)}));
 road.clearChunks();imageCache.clear();if(global.gc)global.gc();
}
console.log('complete');
