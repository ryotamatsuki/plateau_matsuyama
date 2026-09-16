import assert from 'node:assert/strict';
import { chromium, webkit, devices } from 'playwright';

const target = (process.argv[2] || 'http://127.0.0.1:8000/').replace(/\/?$/, '/');

async function waitReady(page, timeout = 120000) {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__matsuyamaViewer && window.MatsuyamaWalk && window.MatsuyamaNavigation?.debug, null, { timeout });
  await page.waitForFunction(() => document.querySelector('#terrainStatus')?.textContent.includes('DEM10B'), null, { timeout });
}

async function desktop() {
  const browser = await chromium.launch({ headless:true, args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport:{width:1440,height:900}, deviceScaleFactor:1 });
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console', m=>{ if(m.type()==='error' && !/favicon|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  await waitReady(page);

  await page.locator('#hazard').selectOption('tsunami');
  await page.locator('#hazardOpacity').evaluate((el)=>{el.value='41';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#basemap').selectOption('std');
  await page.locator('#riskMode').selectOption('flood');
  const layerState = await page.evaluate(()=>({hazard:hazard.value,opacity:hazardOpacity.value,base:basemap.value,risk:riskMode.value}));

  await page.evaluate(()=>window.MatsuyamaWalk.start());
  await page.waitForFunction(()=>window.MatsuyamaNavigation.debug().mode==='GROUND' && window.MatsuyamaNavigation.debug().rafActive);
  let debug=await page.evaluate(()=>window.MatsuyamaNavigation.debug());
  assert.equal(debug.speed,2.8); assert.equal(debug.fast,5.0); assert.equal(debug.owner,'WALK');

  const transitionPromise = page.evaluate(()=>window.MatsuyamaNavigation.toOverview());
  await page.waitForFunction(()=>window.MatsuyamaNavigation.debug().mode==='TRANSITION_TO_OVERVIEW');
  debug=await page.evaluate(()=>window.MatsuyamaNavigation.debug());
  assert.equal(debug.walkActive,false,'walk camera must release ownership during ascent');
  assert.equal(debug.cesiumInputs,false,'Cesium user inputs must be disabled during transition');
  await transitionPromise;
  await page.waitForFunction(()=>window.MatsuyamaNavigation.debug().mode==='OVERVIEW');
  debug=await page.evaluate(()=>window.MatsuyamaNavigation.debug());
  assert.equal(debug.owner,'CESIUM'); assert.equal(debug.cesiumInputs,true);
  assert.ok(debug.lastTransitionMs>=700 && debug.lastTransitionMs<=2200,`ascent duration ${debug.lastTransitionMs}`);

  await page.keyboard.press('KeyF');
  await page.waitForFunction(()=>window.MatsuyamaNavigation.debug().mode==='TRANSITION_TO_GROUND');
  await page.waitForFunction(()=>window.MatsuyamaNavigation.debug().mode==='GROUND' && window.MatsuyamaWalk.state.active,{timeout:10000});
  debug=await page.evaluate(()=>window.MatsuyamaNavigation.debug());
  assert.ok(debug.lastLanding && Number.isFinite(debug.lastLanding.ground));
  const sync=await page.evaluate(()=>({
    dLon:Math.abs(window.MatsuyamaWalk.state.lon-window.MatsuyamaNavigation.debug().lastLanding.lon),
    dLat:Math.abs(window.MatsuyamaWalk.state.lat-window.MatsuyamaNavigation.debug().lastLanding.lat),
    dGround:Math.abs(window.MatsuyamaWalk.state.ground-window.MatsuyamaNavigation.debug().lastLanding.ground)
  }));
  assert.ok(sync.dLon<1e-8 && sync.dLat<1e-8 && sync.dGround<0.05,`landing state mismatch ${JSON.stringify(sync)}`);

  const afterLayers=await page.evaluate(()=>({hazard:hazard.value,opacity:hazardOpacity.value,base:basemap.value,risk:riskMode.value}));
  assert.deepEqual(afterLayers,layerState,'camera mode changes must not reset GIS layer state');
  assert.equal(await page.locator('#navFlightToggle').isVisible(),true);
  assert.equal(errors.length,0,`console errors: ${errors.join('\n')}`);
  await browser.close();
}

async function reducedMotion() {
  const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader']});
  const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
  const page=await context.newPage();
  await waitReady(page);
  await page.evaluate(()=>window.MatsuyamaWalk.start());
  await page.waitForFunction(()=>window.MatsuyamaNavigation.debug().mode==='GROUND');
  await page.evaluate(()=>window.MatsuyamaNavigation.toOverview());
  await page.waitForFunction(()=>window.MatsuyamaNavigation.debug().mode==='OVERVIEW');
  const debug=await page.evaluate(()=>window.MatsuyamaNavigation.debug());
  assert.equal(debug.reducedMotion,true);
  assert.ok(debug.lastTransitionMs<650,`reduced motion transition too long: ${debug.lastTransitionMs}`);
  await browser.close();
}

async function mobile() {
  const browser=await webkit.launch({headless:true});
  const context=await browser.newContext({...devices['iPhone 15']});
  const page=await context.newPage();
  await waitReady(page,150000);
  await page.evaluate(()=>window.MatsuyamaWalk.start());
  await page.waitForFunction(()=>window.MatsuyamaNavigation.debug().mode==='GROUND');
  const viewport=page.viewportSize();
  const nav=await page.locator('#navFlightToggle').boundingBox();
  const move=await page.locator('#walkMoveStick').boundingBox();
  const look=await page.locator('#walkLookStick').boundingBox();
  assert.ok(nav&&move&&look&&viewport,'mobile controls must be visible');
  assert.ok(nav.x>=0&&nav.y>=0&&nav.x+nav.width<=viewport.width&&nav.y+nav.height<=viewport.height,'flight button outside viewport');
  const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  assert.equal(overlap(nav,move),0,'flight button overlaps MOVE stick');
  assert.equal(overlap(nav,look),0,'flight button overlaps CAMERA stick');
  await page.evaluate(()=>{const w=window.MatsuyamaWalk;w.setVirtualStick('move',.7,.7);w.setVirtualStick('look',.5,.2);w.stepControls(1/60);});
  const analog=await page.evaluate(()=>window.MatsuyamaWalk.state.analog);
  assert.ok(Math.abs(analog.move.x)>.6&&Math.abs(analog.look.x)>.4,'simultaneous mobile input state lost');
  await page.evaluate(()=>{window.MatsuyamaWalk.setVirtualStick('move',0,0);window.MatsuyamaWalk.setVirtualStick('look',0,0);});
  await page.locator('#navFlightToggle').click();
  await page.waitForFunction(()=>window.MatsuyamaNavigation.debug().mode==='OVERVIEW',{timeout:10000});
  assert.equal(await page.locator('#navFlightToggle').isVisible(),true,'flight button must remain available in overview');
  await page.locator('#navFlightToggle').click();
  await page.waitForFunction(()=>window.MatsuyamaNavigation.debug().mode==='GROUND'&&window.MatsuyamaWalk.state.active,{timeout:10000});
  assert.equal(await page.locator('#walkMoveStick').isVisible(),true);
  assert.equal(await page.locator('#walkLookStick').isVisible(),true);
  await browser.close();
}

await desktop();
await reducedMotion();
await mobile();
console.log(`PASS camera navigation E2E: ${target}`);
