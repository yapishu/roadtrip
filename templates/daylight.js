// A seeded daytime sky changes gently with distance and moving simulation time.
import * as THREE from './vendor/three.module.js';
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const random=(seed,index)=>{let n=(seed^Math.imul(index+1,0x9e3779b9))>>>0;n=Math.imul(n^(n>>>16),0x21f0aaad);n=Math.imul(n^(n>>>15),0x735a2d97);return((n^(n>>>15))>>>0)/4294967296;};
const weather=[
 {name:'clear',top:'#82b4d6',horizon:'#c6d8de',cloud:'#faf6e9',shade:'#c3cbd0',cover:.10,sun:2.0,ambient:2.0,warmth:'#fff0d7'},
 {name:'scattered clouds',top:'#91b5cf',horizon:'#c9d5d8',cloud:'#f5f1e7',shade:'#bdc7cb',cover:.72,sun:1.75,ambient:2.05,warmth:'#f9edd9'},
 {name:'hazy sunshine',top:'#adc5d4',horizon:'#ddd9c9',cloud:'#f3eee2',shade:'#c9cdcb',cover:.30,sun:1.6,ambient:2.08,warmth:'#ffe6c6'},
 {name:'soft overcast',top:'#b1c4d0',horizon:'#d1d8d6',cloud:'#e9edeb',shade:'#b8c4cd',cover:.94,sun:1.1,ambient:2.2,warmth:'#edf1ef'}
];
export function daylightState(seed,distance,seconds=0){
 const position=distance/65000+seconds/2400+random(seed,0)*8,index=Math.floor(position),t=smooth(position-index),a=weather[Math.floor(random(seed,index+1)*weather.length)],b=weather[Math.floor(random(seed,index+2)*weather.length)];
 return {a,b,t,cover:mix(a.cover,b.cover,t),sun:mix(a.sun,b.sun,t),ambient:mix(a.ambient,b.ambient,t),name:t<.5?a.name:b.name};
}
export function addDaylight(scene,sun,hemisphere,seed){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const ctx=canvas.getContext('2d');
 // Wide, gently faceted cloud clusters wrap around the horizon.
 for(let i=0;i<36;i++){
   const cx=random(seed,i*7+40)*1024,cy=30+random(seed,i*7+41)*202,width=24+random(seed,i*7+42)*75,height=width*(.2+random(seed,i*7+43)*.2);
   for(const shift of [-1024,0,1024])for(let j=0;j<7;j++){
     const x=cx+shift+(random(seed,i*49+j*3+400)-.5)*width,y=cy+(random(seed,i*49+j*3+401)-.5)*height,r=height*(.55+random(seed,i*49+j*3+402)*.5);
     ctx.fillStyle=j<2?'rgba(175,175,175,.76)':'rgba(244,244,244,.9)';ctx.beginPath();
     for(let k=0;k<10;k++){const angle=k/10*Math.PI*2;ctx[k?'lineTo':'moveTo'](x+Math.cos(angle)*r*1.6,y+Math.sin(angle)*r*.68);}ctx.closePath();ctx.fill();
   }
 }
 const texture=new THREE.CanvasTexture(canvas);texture.wrapS=THREE.RepeatWrapping;texture.minFilter=THREE.LinearFilter;
 const uniforms={top:{value:new THREE.Color()},horizon:{value:new THREE.Color()},cloud:{value:new THREE.Color()},shade:{value:new THREE.Color()},cover:{value:0},drift:{value:0},cloudMap:{value:texture}};
 const material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:false,uniforms,
 vertexShader:'varying vec3 direction; void main(){direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
 fragmentShader:`varying vec3 direction; uniform vec3 top,horizon,cloud,shade; uniform float cover,drift; uniform sampler2D cloudMap;
 void main(){vec3 d=normalize(direction); float altitude=max(0.0,d.y); vec3 color=mix(horizon,top,smoothstep(0.0,0.65,altitude));
 vec2 uv=vec2(atan(d.z,d.x)/6.2831853+0.5+drift,asin(clamp(d.y,-1.0,1.0))/3.1415927+0.5); vec4 cloudSample=texture2D(cloudMap,uv);
 float alpha=cloudSample.a*cover*smoothstep(0.015,0.10,altitude); color=mix(color,mix(shade,cloud,cloudSample.r),alpha);
 gl_FragColor=vec4(color,1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
 const mesh=new THREE.Mesh(new THREE.SphereGeometry(42000,32,16),material);mesh.frustumCulled=false;mesh.renderOrder=-1000;scene.add(mesh);
 const interpolate=(target,a,b,t)=>target.set(a).lerp(new THREE.Color(b),t);let state;
 return {update(distance,seconds,camera){
   state=daylightState(seed,distance,seconds);const {a,b,t}=state;
   for(const key of ['top','horizon','cloud','shade'])interpolate(uniforms[key].value,a[key],b[key],t);
   uniforms.cover.value=state.cover;uniforms.drift.value=seconds*.000008;mesh.position.copy(camera.position);
   interpolate(scene.fog.color,a.horizon,b.horizon,t);interpolate(sun.color,a.warmth,b.warmth,t);
   sun.intensity=state.sun;hemisphere.intensity=state.ambient;
 },stats:()=>state?{name:state.name,cloudCover:state.cover,sun:state.sun,ambient:state.ambient,seed}:null};
}
