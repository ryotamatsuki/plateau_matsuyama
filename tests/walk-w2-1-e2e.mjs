import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const target=(process.argv[2]||'http://127.0.0.1:8000/').replace(/\/?$/,'/');
const artifacts=process.env.E2E_ARTIFACT_DIR||'e2e-artifacts';
fs.mkdirSync(artifacts,{recursive:true});

const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
page.on('pageerror',(e)=>errors.push(e.message));
page.on('console',(m)=>{if(m.type()==='error')errors.push(m.text());});

try{
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.__matsuyamaViewer&&!window.__matsuyamaViewer.isDestroyed(),null,{timeout:120000});
  await page.waitForFunction(()=>window.MatsuyamaWalk?.debug&&window.MatsuyamaNavigation?.debug,null,{timeout:60000});

  let before=await page.evaluate(()=>({
    walk:window.MatsuyamaWalk.debug(),
    timer:window.MatsuyamaWalk.state.timer,
    nav:window.MatsuyamaNavigation.debug()
  }));
  assert.equal(before.walk.scheduler,'requestAnimationFrame');
  assert.equal(before.walk.loop.rafActive,false);
  assert.equal(before.timer,0);

  await page.evaluate(()=>window.MatsuyamaWalk.start());
  await page.waitForFunction(()=>window.MatsuyamaWalk.debug().loop.rafActive&&window.MatsuyamaNavigation.debug().rafActive,null,{timeout:10000});
  await page.waitForTimeout(900);

  const running=await page.evaluate(()=>({
    walk:window.MatsuyamaWalk.debug(),
    timer:window.MatsuyamaWalk.state.timer,
    nav:window.MatsuyamaNavigation.debug()
  }));
  assert.equal(running.walk.scheduler,'requestAnimationFrame');
  assert.equal(running.timer,0,'legacy setInterval timer must remain unused');
  assert.equal(running.nav.walkScheduler,'requestAnimationFrame');
  assert.equal(running.nav.owner,'WALK');
  assert.equal(running.nav.rafActive,true);
  assert.ok(running.walk.loop.frameCount>5,JSON.stringify(running.walk.loop));
  assert.ok(running.walk.loop.stepCount<=running.walk.loop.frameCount+2,
    `more control steps than owned RAF frames suggests a duplicate loop: ${JSON.stringify(running.walk.loop)}`);
  assert.ok(running.walk.loop.frameMs>0);
  assert.ok(running.walk.loop.collisionIntervalMs>=30&&running.walk.loop.collisionIntervalMs<=35);

  const throttle=await page.evaluate(()=>{
    const w=window.MatsuyamaWalk;
    w.stopGameLoop();
    const scene=window.__matsuyamaViewer.scene;
    const original=scene.pickFromRay;
    let probes=0;
    scene.pickFromRay=function(){probes++;return undefined;};
    const before=w.state.collisionChecks;
    const saved={lon:w.state.lon,lat:w.state.lat,ground:w.state.ground};
    // W2.3 uses local CPU colliders in the central area. Move this legacy W2.1
    // ray-throttle assertion outside that coverage so it continues testing the
    // fallback ray path rather than contradicting the newer architecture.
    w.state.lon=132.90; w.state.lat=33.90; w.state.ground=50;
    w.state.lastCollision=-Infinity;
    w.setVirtualStick('move',0,1);
    const now=performance.now()+1000;
    for(let i=0;i<20;i++)w.stepControls(1/120,now);
    w.setVirtualStick('move',0,0);
    scene.pickFromRay=original;
    const result={checks:w.state.collisionChecks-before,probes};
    Object.assign(w.state,saved);
    w.startGameLoop();
    return result;
  });
  assert.equal(throttle.checks,1,`collision should be sampled once for 20 same-frame control steps: ${JSON.stringify(throttle)}`);
  assert.equal(throttle.probes,1,`pickFromRay should be decoupled from display-rate control steps: ${JSON.stringify(throttle)}`);

  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>window.MatsuyamaWalk.debug().loop.rafActive),true);

  await page.evaluate(()=>window.MatsuyamaWalk.stop());
  const stopped=await page.evaluate(()=>window.MatsuyamaWalk.debug());
  assert.equal(stopped.active,false);
  assert.equal(stopped.loop.rafActive,false);
  const frameAtStop=stopped.loop.frameCount;
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>window.MatsuyamaWalk.debug().loop.frameCount),frameAtStop,'frames advanced after stop');

  await page.evaluate(()=>window.MatsuyamaWalk.start());
  await page.waitForFunction(()=>window.MatsuyamaWalk.debug().loop.frameCount>3,null,{timeout:10000});
  const restarted=await page.evaluate(()=>window.MatsuyamaWalk.debug());
  assert.equal(restarted.loop.rafActive,true);
  assert.ok(restarted.loop.stepCount<=restarted.loop.frameCount+2);
  await page.evaluate(()=>window.MatsuyamaWalk.stop());

  const materialErrors=errors.filter(x=>!/favicon|ResizeObserver loop|Failed to load resource/i.test(x));
  assert.deepEqual(materialErrors,[],`browser errors: ${materialErrors.join(' | ')}`);

  const report={before,running,throttle,restarted};
  fs.writeFileSync(path.join(artifacts,'walk-w2-1-debug.json'),JSON.stringify(report,null,2));
  await page.screenshot({path:path.join(artifacts,'walk-w2-1.png'),animations:'disabled',timeout:90000});
  console.log('PASS Walk W2.1 game loop',JSON.stringify({
    frames:running.walk.loop.frameCount,
    steps:running.walk.loop.stepCount,
    measuredFps:running.walk.loop.fps,
    collisionChecks:running.walk.loop.collisionChecks,
    throttle
  }));
}finally{
  await browser.close();
}
