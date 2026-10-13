// A north-up terrain atlas in the same metre coordinates as the driving world.
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function simplify(points,tolerance) {
  const keep=new Uint8Array(points.length), stack=[[0,points.length-1]], limit=tolerance*tolerance;
  keep[0]=keep[points.length-1]=1;
  while(stack.length){const [first,last]=stack.pop(),a=points[first],b=points[last],dx=b[0]-a[0],dy=b[1]-a[1],dd=dx*dx+dy*dy;let far=limit,index=-1;
    for(let i=first+1;i<last;i++){const p=points[i],t=dd?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/dd,0,1):0,d=(p[0]-a[0]-dx*t)**2+(p[1]-a[1]-dy*t)**2;if(d>far){far=d;index=i;}}
    if(index>=0){keep[index]=1;stack.push([first,index],[index,last]);}
  }
  return points.filter((_,i)=>keep[i]);
}

export function createMiniMap({root, getRoad, getPosition, getCaption}) {
  root.innerHTML = `<button id="atlas-toggle" aria-label="Expand terrain map" aria-expanded="false" title="Expand map (M)">⤢</button>
    <canvas id="atlas-canvas" tabindex="0" role="img" aria-label="Terrain map with state borders, route, and your white sedan. Click to expand; scroll to zoom."></canvas>
    <div id="atlas-tools"><button id="atlas-trip" aria-label="Show whole trip" title="Whole trip">⌂</button><button id="atlas-follow" aria-label="Follow car" aria-pressed="true" title="Follow car">◎</button><button id="atlas-out" aria-label="Zoom out" title="Zoom out">−</button><button id="atlas-in" aria-label="Zoom in" title="Zoom in">+</button></div>`;
  root.dataset.expanded = 'false';
  const $ = id => root.querySelector('#'+id), canvas = $('atlas-canvas'), ctx = canvas.getContext('2d');
  const buffer = document.createElement('canvas'), g = buffer.getContext('2d');
  let atlas, heights, expanded = false, follow = true, span = 450000, center = null, drag = null, drawn = '', lastState;
  const ready = Promise.all([fetch('map/atlas.json').then(r => {if (!r.ok) throw Error('Atlas unavailable'); return r.json();}),
    fetch('map/terrain.bin').then(r => {if (!r.ok) throw Error('Terrain unavailable'); return r.arrayBuffer();})])
    .then(([data, terrain]) => {atlas = data; heights = new Int16Array(terrain); update(true);})
    .catch(e => { canvas.setAttribute('aria-label', 'Map unavailable'); console.warn(e.message); });

  function routeAt(s) {
    const ps = atlas.route;
    let lo = 0, hi = ps.length-1;
    while (lo < hi-1) {const m = (lo+hi)>>1; if (ps[m][0] > s) hi = m; else lo = m;}
    const a = ps[lo], b = ps[hi], t = clamp((s-a[0])/(b[0]-a[0] || 1), 0, 1);
    return {position: [a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t], direction: [b[1]-a[1], b[2]-a[2]]};
  }
  function state() {return getRoad().mapState(getPosition()) || routeAt(getPosition());}
  function setFollow(value) {follow = value; $('atlas-follow').setAttribute('aria-pressed', String(value));}
  function fitTrip() {
    if (!atlas) return;
    const [x0,y0,x1,y1] = atlas.bounds;
    center = [(x0+x1)/2, (y0+y1)/2];
    span = Math.max(x1-x0, (y1-y0)*canvas.clientWidth/canvas.clientHeight)*1.15;
    setFollow(false); update(true);
  }
  function setExpanded(value) {
    expanded = value; root.dataset.expanded = String(value);
    $('atlas-toggle').setAttribute('aria-expanded', String(value));
    $('atlas-toggle').setAttribute('aria-label', value ? 'Collapse terrain map' : 'Expand terrain map');
    $('atlas-toggle').textContent = value ? '−' : '⤢';
    if (value) fitTrip();
    else {span = 450000; setFollow(true); update(true);}
  }
  function zoom(factor, point) {
    if (!atlas || !center) return;
    const old = span, next = clamp(span*factor, 600, 3400000), height = canvas.height/canvas.width;
    if (point && !follow) {
      center[0] += (point[0]-.5)*(old-next);
      center[1] -= (point[1]-.5)*(old-next)*height;
    }
    span = next; update(true);
  }
  $('atlas-toggle').addEventListener('click', () => setExpanded(!expanded));
  $('atlas-trip').addEventListener('click', fitTrip);
  $('atlas-follow').addEventListener('click', () => {setFollow(true); span = Math.min(span, 180000); update(true);});
  $('atlas-in').addEventListener('click', () => zoom(.65));
  $('atlas-out').addEventListener('click', () => zoom(1/.65));
  root.addEventListener('wheel', e => {
    e.preventDefault(); e.stopPropagation();
    const rect = canvas.getBoundingClientRect(), delta = e.deltaY*(e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1);
    zoom(Math.exp(clamp(delta, -400, 400)*.0025), [(e.clientX-rect.left)/rect.width, (e.clientY-rect.top)/rect.height]);
  }, {passive: false});
  root.addEventListener('touchstart', e => e.stopPropagation(), {passive: true});
  root.addEventListener('touchmove', e => e.stopPropagation(), {passive: true});
  canvas.addEventListener('pointerdown', e => {
    if (!atlas || !center) return;
    drag = {x:e.clientX, y:e.clientY, center:[...center], moved:false};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
    if (Math.hypot(dx,dy)<4 && !drag.moved) return;
    drag.moved = true; root.dataset.dragging = 'true'; setFollow(false);
    const metres = span/canvas.clientWidth;
    center = [drag.center[0]-dx*metres, drag.center[1]+dy*metres]; update(true);
  });
  canvas.addEventListener('pointerup', e => {
    const click = drag && !drag.moved; drag = null; root.dataset.dragging = 'false';
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (click && !expanded) setExpanded(true);
  });
  canvas.addEventListener('pointercancel', () => {drag=null; root.dataset.dragging='false';});
  root.addEventListener('keydown', e => {
    if (e.key==='Escape') setExpanded(false);
    else if (e.key==='+' || e.key==='=') zoom(.65);
    else if (e.key==='-') zoom(1/.65);
    else if ((e.key==='Enter' || e.key===' ') && e.target===canvas) setExpanded(!expanded);
    else return;
    e.preventDefault(); e.stopPropagation();
  });
  const resize = new ResizeObserver(() => update(true)); resize.observe(canvas);

  function sample(grid, values, x, y, scale=1, offset=0) {
    const px=(x-grid.x0)/grid.cell, py=(y-grid.y0)/grid.cell;
    if (px<0 || py<0 || px>=grid.w-1 || py>=grid.h-1) return null;
    const ix=Math.floor(px), iy=Math.floor(py), a=px-ix, b=py-iy, k=iy*grid.w+ix;
    return ((values[k]*(1-a)+values[k+1]*a)*(1-b)+(values[k+grid.w]*(1-a)+values[k+grid.w+1]*a)*b)*scale+offset;
  }
  function elevation(x,y,chunk) {
    if (chunk && span<120000) {
      const d=chunk.d, localX=x-d.origin[0], localY=y-d.origin[1];
      for (const [i,key] of (span<22000 ? [[0,'near'],[1,'far']] : [[1,'far']])) {
        const grid=d[key], h=sample(grid,chunk.values[i].a,localX,localY,grid.scale,grid.offset);
        if (h!==null) return h;
      }
    }
    return sample(atlas.terrain,heights,x,y) ?? 0;
  }
  function pixelLine(a,b,width,height) {
    const dx=b[0]-a[0],dy=b[1]-a[1];let first=0,last=1;
    for(const [p,q] of [[-dx,a[0]],[dx,width-1-a[0]],[-dy,a[1]],[dy,height-1-a[1]]]){
      if(!p){if(q<0)return;continue;}
      const t=q/p;if(p<0)first=Math.max(first,t);else last=Math.min(last,t);if(first>last)return;
    }
    let x=Math.round(a[0]+dx*first),y=Math.round(a[1]+dy*first);
    const endX=Math.round(a[0]+dx*last),endY=Math.round(a[1]+dy*last),sx=x<endX?1:-1,sy=y<endY?1:-1,ax=Math.abs(endX-x),ay=-Math.abs(endY-y);let error=ax+ay;
    for(;;){g.fillRect(x,y,1,1);if(x===endX&&y===endY)break;const next=2*error;if(next>=ay){error+=ay;x+=sx;}if(next<=ax){error+=ax;y+=sy;}}
  }
  function backdrop(width,height,view) {
    buffer.width=width; buffer.height=height; g.imageSmoothingEnabled=false;
    const metres=span/width, left=center[0]-span/2, top=center[1]+height*metres/2;
    const project=p=>[(p[0]-left)/metres,(top-p[1])/metres];
    // Fixed world-space triangles keep the mountain facets still while driving.
    const step=2**Math.round(Math.log2(span/(expanded?28:16))), x0=Math.floor(left/step)*step, y0=Math.floor((top-height*metres)/step)*step;
    g.fillStyle='#a9b7ac'; g.fillRect(0,0,width,height);
    function triangle(points) {
      const z=points.map(p=>elevation(p[0],p[1],view.chunk)), mean=z.reduce((a,b)=>a+b)/3;
      const a=points[0],b=points[1],c=points[2],ab=[b[0]-a[0],b[1]-a[1],(z[1]-z[0])*5],ac=[c[0]-a[0],c[1]-a[1],(z[2]-z[0])*5];
      let nx=ab[1]*ac[2]-ab[2]*ac[1], ny=ab[2]*ac[0]-ab[0]*ac[2], nz=ab[0]*ac[1]-ab[1]*ac[0];
      if(nz<0){nx=-nx;ny=-ny;nz=-nz;}
      const n=Math.hypot(nx,ny,nz)||1, shade=Math.round(clamp((-.45*nx+.45*ny+.77*nz)/n,.1,1)*7)/7;
      const base=mean<0?[155,177,168]:mean<400?[177,185,142]:mean<1200?[188,184,139]:mean<2300?[186,170,129]:mean<3100?[169,157,127]:[196,190,167];
      const light=.77+shade*.28;
      g.fillStyle=`rgb(${base.map(v=>Math.round(v*light)).join(',')})`;
      g.beginPath(); points.forEach((p,i)=>g[i?'lineTo':'moveTo'](...project(p)));g.closePath();g.fill();
      g.strokeStyle=g.fillStyle;g.lineWidth=.55;g.stroke();
    }
    for(let y=y0;y<top+step;y+=step)for(let x=x0;x<left+span+step;x+=step){
      const a=[x,y],b=[x+step,y],c=[x+step,y+step],d=[x,y+step];
      if((Math.round(x/step)+Math.round(y/step))%2){triangle([a,b,d]);triangle([b,c,d]);}
      else {triangle([a,b,c]);triangle([a,c,d]);}
    }
    g.strokeStyle='#66745e';g.lineWidth=expanded?1:.8;g.setLineDash([4,3]);
    for(const state of atlas.states)for(const ring of state.rings){g.beginPath();ring.forEach((p,i)=>g[i?'lineTo':'moveTo'](...project(p)));g.stroke();}
    g.setLineDash([]);
    if(span<12000 && view.chunk){
      const {d}=view.chunk;g.fillStyle='#a0a183';
      for(const road of d.roads){if(/path|footway|steps|track|service/.test(road.kind))continue;if(span>6000&&road.kind==='residential')continue;const points=simplify(road.points.map(p=>project([p[0]+d.origin[0],p[1]+d.origin[1]])),1.25);for(let i=1;i<points.length;i++)pixelLine(points[i-1],points[i],width,height);}
    }
    // Simplify at the current pixel scale, then rasterize the road as whole pixels.
    const path=simplify(atlas.route.map(p=>project([p[1],p[2]])),1.25);
    g.fillStyle='#927154';
    for(let i=1;i<path.length;i++)pixelLine(path[i-1],path[i],width,height);
    if(span>100000){
      g.font=`${expanded?7:5}px monospace`;g.textAlign='center';g.textBaseline='middle';
      for(const state of atlas.states){const [x,y]=project(state.label);if(x<12||x>width-12||y<8||y>height-8)continue;const name=state.code;g.fillStyle='#526149';g.fillText(name,Math.round(x),Math.round(y));}
    }
    if(expanded && span>400000){
      const chosen=atlas.stops.filter(s=>/Milpitas|Las Vegas|Albuquerque|Denton/.test(s.name));
      g.font='6px monospace';g.textAlign='left';
      for(const stop of chosen){const [x,y]=project(stop.xy);if(x<5||x>width-5||y<8||y>height-8)continue;g.fillStyle='#665d49';g.fillRect(Math.round(x)-1,Math.round(y)-1,3,3);const name=stop.name.split(',')[0];g.textAlign=x>width-90?'right':'left';g.strokeStyle='#ded6b9';g.lineWidth=3;g.strokeText(name,x+(x>width-90?-5:5),y-6);g.fillText(name,x+(x>width-90?-5:5),y-6);}
    }
  }
  function sedan(g,x,y,heading) {
    g.save();g.translate(Math.round(x),Math.round(y));g.rotate(heading);g.scale(.6,.6);
    g.fillStyle='#35403755';g.fillRect(-4,-6,9,16);
    g.fillStyle='#363d36';g.fillRect(-4,-4,2,4);g.fillRect(3,-4,2,4);g.fillRect(-4,4,2,3);g.fillRect(3,4,2,3);
    g.fillStyle='#f5f2df';g.fillRect(-3,-6,7,14);g.fillRect(-2,-7,5,16);
    g.fillStyle='#758b8e';g.fillRect(-2,-3,5,3);g.fillRect(-2,4,5,2);
    g.fillStyle='#fffdf0';g.fillRect(-2,0,5,4);g.fillRect(-2,-6,5,2);
    g.fillStyle='#b57458';g.fillRect(-2,7,1,1);g.fillRect(2,7,1,1);
    g.restore();
  }
  function update(force=false) {
    if(!atlas)return;
    const view=state();lastState=view;
    if(follow || !center)center=[...view.position];
    const width=Math.max(1,Math.round(Math.min(660,canvas.clientWidth)/2)), height=Math.max(1,Math.round(width*canvas.clientHeight/Math.max(1,canvas.clientWidth)));
    if(!width)return;
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    const key=[width,height,span,...center.map(v=>Math.round(v/(span/width/4))),view.chunk?.d.c,view.chunk?.source].join(':');
    if(force||key!==drawn){backdrop(width,height,view);drawn=key;}
    ctx.imageSmoothingEnabled=false;ctx.drawImage(buffer,0,0);
    // Keep moving markers separate from the terrain cache.
    const overlay=ctx, metres=span/width;
    const x=(view.position[0]-center[0])/metres+width/2,y=(center[1]-view.position[1])/metres+height/2;
    if(x>-10&&y>-16&&x<width+10&&y<height+16)sedan(overlay,x,y,Math.atan2(view.direction[0],view.direction[1]));
    overlay.fillStyle='#40513e';overlay.font='bold 6px monospace';overlay.textAlign='center';overlay.fillText('N',9,11);
    overlay.beginPath();overlay.moveTo(9,13);overlay.lineTo(7,17);overlay.lineTo(11,17);overlay.closePath();overlay.fill();
    const target=span*.23/1609.344, power=10**Math.floor(Math.log10(target)), miles=[1,2,5].map(v=>v*power).filter(v=>v<=target).at(-1)||power;
    const length=miles*1609.344/metres;overlay.strokeStyle='#40513e';overlay.lineWidth=1;overlay.beginPath();overlay.moveTo(6,height-8);overlay.lineTo(6,height-6);overlay.lineTo(6+length,height-6);overlay.lineTo(6+length,height-8);overlay.stroke();
    overlay.textAlign='left';overlay.font='5px monospace';overlay.fillText(`${+miles.toPrecision(2)} mi`,6,height-11);
    const place=getCaption();
    canvas.setAttribute('aria-label',`Terrain map near ${place}. White sedan marks your position. Scroll to zoom, drag to pan.`);
  }
  return {update,ready,toggle:()=>setExpanded(!expanded),collapse:()=>setExpanded(false),
    get state(){return {expanded,follow,span,center,position:lastState?.position,direction:lastState?.direction};}};
}
