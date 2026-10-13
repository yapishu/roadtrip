// Exercise touch navigation, idle rendering, the frame cap, and route looping.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

const url=process.argv[2]||'http://127.0.0.1:8088/',errors=[];
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
page.on('pageerror',error=>errors.push(error.message));
const report={checked:new Date().toISOString()};
try {
  await page.goto(new URL('?paused=1&fps=30',url).href);
  await page.waitForFunction(()=>window.__trip?.road.ready(__trip.pos),{timeout:60000});
  await page.touchscreen.tap(60,400);
  await page.locator('#stops').tap();
  await page.waitForFunction(()=>document.querySelector('#stop-picker').open);
  const rect=await page.locator('#stop-list').boundingBox(),cdp=await page.context().newCDPSession(page);
  const x=rect.x+rect.width*.5,y=rect.y+rect.height*.8;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*20}]});await page.waitForTimeout(20);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(250);
  report.fingerScrollPixels=await page.locator('#stop-list').evaluate(e=>e.scrollTop);
  assert.ok(report.fingerScrollPixels>100,'A finger swipe scrolls the stop list');
  const choice=page.locator('#stop-list button').filter({hasText:'Brian Head Resort'});
  await choice.scrollIntoViewIfNeeded();await choice.tap();
  await page.waitForFunction(()=>!document.querySelector('#stop-picker').open&&__trip.road.ready(__trip.pos),{timeout:60000});
  report.stop=await page.evaluate(()=>({source:__trip.road.locate(__trip.pos).source,paused:document.querySelector('#play').textContent,position:__trip.pos,stops:__trip.road.IDX.stops.map(s=>s.name)}));
  assert.equal(report.stop.source,'detours/brian-head');assert.equal(report.stop.paused,'Play');
  assert.ok(report.stop.stops.indexOf('Brian Head Resort')<report.stop.stops.indexOf('Panguitch, Utah'));
  await page.waitForTimeout(300);
  const idle=await page.evaluate(()=>({draws:__trip.road.stats().draws,time:__trip.road.T.now}));
  await page.waitForTimeout(1200);
  report.idleDraws=await page.evaluate(()=>__trip.road.stats().draws)-idle.draws;
  report.idleAnimationSeconds=await page.evaluate(()=>__trip.road.T.now)-idle.time;
  assert.equal(report.idleAnimationSeconds,0,'A paused drive freezes the animation clock');
  assert.equal(report.idleDraws,0,'A paused drive performs no WebGL redraws');
  await page.locator('#play').tap();
  const start=await page.evaluate(()=>({t:performance.now(),draws:__trip.road.stats().draws,pos:__trip.pos}));
  await page.waitForTimeout(2000);
  const end=await page.evaluate(()=>({t:performance.now(),draws:__trip.road.stats().draws,pos:__trip.pos}));
  report.drawsPerSecond=(end.draws-start.draws)*1000/(end.t-start.t);
  assert.ok(report.drawsPerSecond<=32&&end.pos>start.pos,'The 30 fps cap preserves movement');
  const length=await page.evaluate(()=>__trip.road.LEN);
  await page.goto(new URL(`?fps=30&speed=360&km=${(length-1)/1000}`,url).href);
  await page.waitForFunction(()=>window.__trip&&__trip.pos>15&&__trip.pos<500&&__trip.road.ready(__trip.pos),{timeout:90000});
  report.loopPosition=await page.evaluate(()=>__trip.pos);
  assert.deepEqual(errors,[]);report.runtimeErrors=errors;
  if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
