import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {chromium,webkit,devices} from 'playwright';
import {stage1Routes} from './stage1-test-support.mjs';
const target=process.argv[2]||'http://127.0.0.1:8000/';
const artifacts='e2e-artifacts';fs.mkdirSync(artifacts,{recursive:true});
const fixture=gunzipSync(fs.readFileSync('tests/fixtures/matsuyama-osm.json.gz'));
const report={target,devices:[],phases:[]};
const snapshot=page=>page.evaluate(()=>({stage:window.MatsuyamaProceduralStage1.debug(),entities:window.__matsuyamaViewer.entities.values.length,heap:performance.memory?.usedJSHeapSize??null,readyMs:performance.now()}));
async function screenshot(page,name){
 const info=await snapshot(page);report.phases.push({name,info});fs.writeFileSync(`${artifacts}/stage1-performance.json`,JSON.stringify(report,null,2));console.log('VISUAL PHASE',name,JSON.stringify(info));
 // Capture the Chromium compositor directly: Playwright's screenshot stabilization can wait indefinitely on a continuously rendered WebGL canvas.
 if(page.context().browser().browserType()===chromium){const session=await page.context().newCDPSession(page);try{const result=await session.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});fs.writeFileSync(`${artifacts}/${name}.png`,Buffer.from(result.data,'base64'));}finally{await session.detach();}}
 else await page.screenshot({path:`${artifacts}/${name}.png`,animations:'disabled',timeout:90000});
}
async function checkbox(page,checked){const el=page.locator('#proceduralStage1');await el.scrollIntoViewIfNeeded();
  const hit=await el.evaluate(e=>{const b=e.getBoundingClientRect(),h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return{hit:h===e,box:b.toJSON(),tag:h?.tagName};});
  assert.equal(hit.hit,true,`Stage 1 checkbox covered: ${JSON.stringify(hit)}`);await el.setChecked(checked);}
async function view(page,close=false){await page.evaluate(close=>{const v=window.__matsuyamaViewer,C=Cesium;
  if(close){v.camera.lookAt(C.Cartesian3.fromDegrees(132.7658,33.8379,38),new C.HeadingPitchRange(C.Math.toRadians(12),C.Math.toRadians(-24),190));v.camera.lookAtTransform(C.Matrix4.IDENTITY);}
  else v.camera.setView({destination:C.Cartesian3.fromDegrees(132.7657,33.8392,650),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});
  v.scene.requestRender();},close);await page.waitForTimeout(1500);}
async function frames(page){return page.evaluate(()=>new Promise(resolve=>{const v=window.__matsuyamaViewer,start=performance.now(),times=[];let prev=start;
  function tick(now){times.push(now-prev);prev=now;v.scene.requestRender();if(now-start<3000)requestAnimationFrame(tick);else resolve({frames:times.length,duration:now-start,frameTimes:times,entities:v.entities.values.length,heap:performance.memory?.usedJSHeapSize??null});}requestAnimationFrame(tick);
}));}
async function bootOff(type,mobile){
 const browser=await type.launch({headless:true,...(type===chromium?{args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader']}: {})});
 const context=await browser.newContext(mobile?{...devices['iPhone 15']}:{viewport:{width:1280,height:800},deviceScaleFactor:1});const page=await context.newPage();await stage1Routes(page);
 await page.addInitScript(()=>{const observer=new MutationObserver(()=>{const el=document.getElementById('proceduralStage1');if(el){el.checked=false;observer.disconnect();}});observer.observe(document,{childList:true,subtree:true});});
 try{await page.goto(target,{waitUntil:'domcontentloaded',timeout:90000});await page.waitForFunction(()=>window.MatsuyamaProceduralStage1?.debug().ready,null,{timeout:150000});const result=await snapshot(page);assert.equal(result.stage.enabled,false);assert.equal(result.stage.shader,false);assert.equal(result.entities,0);return result;}finally{await browser.close();}
}
async function run(type,name,mobile=false){
 const bootBaseline=await bootOff(type,mobile);
 const browser=await type.launch({headless:true,...(type===chromium?{args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader']}: {})});
 const context=await browser.newContext(mobile?{...devices['iPhone 15']}:{viewport:{width:1280,height:800},deviceScaleFactor:1});
 const page=await context.newPage(),errors=[];let osmCalls=0;
 page.on('pageerror',e=>{errors.push(e.message);console.error(name,'pageerror',e.stack)});
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|favicon/.test(m.text())){errors.push(m.text());console.error(name,m.text())}});
 await stage1Routes(page);
 await page.route(/https:\/\/overpass[^/]*\/api\/interpreter$/,r=>{osmCalls++;return r.fulfill({status:200,contentType:'application/json',body:fixture})});
 try{
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.MatsuyamaProceduralStage1?.debug().ready,null,{timeout:150000});
  const boot=await snapshot(page);assert.equal(osmCalls,0,'OSM must not load in initial overview');assert.equal(boot.stage.shader,false);assert.equal(boot.stage.roadEntities,0);assert.equal(boot.stage.ao,false);assert.equal(boot.stage.shadows,false);
  await checkbox(page,false);assert.equal((await snapshot(page)).stage.shader,false);
  await view(page);await page.waitForTimeout(7000);await screenshot(page,`${name}-off-overview`);
  const offFrames=await frames(page);console.log('FRAMES OFF',JSON.stringify(offFrames));
  await checkbox(page,true);
  await page.waitForFunction(()=>window.MatsuyamaProceduralStage1.debug().streetLoaded,null,{timeout:120000});
  let s=await snapshot(page);assert.ok(osmCalls>0);assert.ok(s.stage.roadLayer);assert.ok(s.stage.roadFeatures>0);assert.ok(s.stage.streetEntities>0);assert.ok(s.stage.roads<=(mobile?150:260));assert.ok(s.stage.trees<=(mobile?70:150));assert.ok(s.stage.lamps<=(mobile?70:160));
  const sources=await page.evaluate(()=>[...new Set(window.__matsuyamaViewer.entities.values.filter(e=>e.properties?.stage1?.getValue()).map(e=>e.properties.source.getValue()))]);assert.ok(sources.includes('osm'));assert.ok(sources.includes('interpolated'));
  const heights=await page.evaluate(async()=>{const samples=window.MatsuyamaProceduralStage1.streetSamples();return Promise.all(samples.slice(0,5).map(async q=>({ground:q.ground,authoritative:await window.MatsuyamaTerrain.sampleEllipsoidHeight(...q.p)})))});
  for(const h of heights)assert.ok(Number.isFinite(h.authoritative)&&Math.abs(h.ground-h.authoritative)<.05);
  const onFrames=await frames(page);console.log('FRAMES ON',JSON.stringify(onFrames));await screenshot(page,`${name}-on-overview`);
  for(const mode of ['flood','tsunami','landslide']){await page.selectOption('#riskMode',mode);await page.waitForFunction(()=>!window.MatsuyamaProceduralStage1.debug().shader);assert.equal((await snapshot(page)).stage.shaderUniform,0);assert.equal((await snapshot(page)).stage.ao,false);}
  await page.selectOption('#riskMode','normal');await page.waitForFunction(()=>window.MatsuyamaProceduralStage1.debug().shader);
  await view(page,true);await page.waitForTimeout(5000);
  if(!mobile){await page.waitForFunction(()=>window.MatsuyamaProceduralStage1.debug().close);assert.equal((await snapshot(page)).stage.shadows,true);assert.equal((await snapshot(page)).stage.ao,true);}
  else {assert.equal((await snapshot(page)).stage.ao,false);assert.equal((await snapshot(page)).stage.shadows,false);}
  await page.locator('#panelToggle').click();const closeOn=await frames(page);console.log('CLOSE ON',JSON.stringify(closeOn));await screenshot(page,`${name}-on-street`);
  // Rendering and picking with the actual shader attached must not throw.
  const picked=await page.evaluate(()=>{const v=window.__matsuyamaViewer;const start=performance.now();const p=v.scene.pick(new Cesium.Cartesian2(v.canvas.clientWidth/2,v.canvas.clientHeight/2));return {building:p instanceof Cesium.Cesium3DTileFeature,ms:performance.now()-start};});assert.equal(picked.building,true);console.log('CLOSE PICK',JSON.stringify(picked));
  await page.locator('#panelToggle').click();await checkbox(page,false);
  const off=await snapshot(page);assert.equal(off.stage.shader,false);assert.equal(off.stage.visibleStreetEntities,0);assert.equal(off.stage.roadLayerVisible,false);assert.equal(off.stage.ao,false);assert.equal(off.stage.shadows,false);
  await page.locator('#panelToggle').click();await screenshot(page,`${name}-off-street`);const closeOff=await frames(page);
  await page.locator('#panelToggle').click();await checkbox(page,true);
  await page.evaluate(()=>{const v=window.__matsuyamaViewer;v.camera.setView({destination:Cesium.Cartesian3.fromDegrees(132.718,33.864,2300),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});v.scene.requestRender()});
  await page.waitForFunction(()=>!window.MatsuyamaProceduralStage1.debug().near);assert.equal((await snapshot(page)).stage.visibleStreetEntities,0);assert.equal((await snapshot(page)).stage.roadLayerVisible,false);
  assert.equal(errors.length,0,errors.join('\n'));
  report.devices.push({name,bootBaseline,boot,loaded:s,offFrames,onFrames,closeOn,closeOff,sources,heights,errors});console.log('PASS Stage 1',name,JSON.stringify({boot,loaded:s}));
 }finally{await browser.close();fs.writeFileSync(`${artifacts}/stage1-performance.json`,JSON.stringify(report,null,2));}
}
async function failure(){const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader']});const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await stage1Routes(page);
 await page.route(/https:\/\/overpass[^/]*\/api\/interpreter$/,r=>r.fulfill({status:503,body:'fixture unavailable'}));
 try{await page.goto(target,{waitUntil:'domcontentloaded',timeout:90000});await page.waitForFunction(()=>window.MatsuyamaProceduralStage1?.debug().ready,null,{timeout:150000});await view(page);
  await page.waitForFunction(()=>window.MatsuyamaProceduralStage1.debug().streetFailed);assert.equal((await snapshot(page)).stage.shader,true);assert.ok(await page.locator('#buildingStatus').textContent());
  await page.selectOption('#basemap','std');await page.waitForFunction(()=>window.MatsuyamaImmersive.debug().base==='std');await page.selectOption('#riskMode','flood');await page.waitForFunction(()=>!window.MatsuyamaProceduralStage1.debug().shader);
  assert.equal(errors.length,0);await screenshot(page,'overpass-failure-gis');console.log('PASS Overpass failure graceful degradation');
 }finally{await browser.close();}}
await run(chromium,'desktop');await run(webkit,'iphone',true);await failure();
console.log('PASS Procedural Stage 1 E2E');
