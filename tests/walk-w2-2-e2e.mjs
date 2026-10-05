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
  await page.waitForFunction(()=>window.__matsuyamaViewer&&window.MatsuyamaWalk?.debug,null,{timeout:120000});
  await page.evaluate(()=>window.MatsuyamaWalk.start());
  await page.waitForFunction(()=>window.MatsuyamaWalk.debug().avatar.ready||window.MatsuyamaWalk.debug().avatar.error,null,{timeout:120000});

  const loaded=await page.evaluate(()=>window.MatsuyamaWalk.debug());
  assert.equal(loaded.scheduler,'requestAnimationFrame');
  assert.equal(loaded.avatar.ready,true,`GLB avatar failed: ${loaded.avatar.error}`);
  assert.equal(loaded.avatar.renderer,'glb-model');
  assert.ok(loaded.avatar.animations.length>=1,`no glTF animation discovered: ${JSON.stringify(loaded.avatar)}`);
  assert.equal(loaded.avatar.modelVisible,true);
  assert.equal(loaded.avatar.fallbackVisible,false);
  assert.match(loaded.avatar.url,/mrdoob\/three\.js\/[0-9a-f]{40}\/examples\/models\/gltf\/RobotExpressive\/RobotExpressive\.glb/);
  assert.match(loaded.avatar.animations.join(','),/Idle/);
  assert.match(loaded.avatar.animations.join(','),/Walking/);
  assert.match(loaded.avatar.animations.join(','),/Running/);
  assert.notEqual(loaded.avatar.animationMap.idle,loaded.avatar.animationMap.walk);
  assert.notEqual(loaded.avatar.animationMap.walk,loaded.avatar.animationMap.run);

  await page.waitForTimeout(350);
  const idle=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(idle.state,'idle');

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(350);
  const walk=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(walk.state,'walk');
  assert.equal(walk.modelVisible,true);

  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(350);
  const run=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(run.state,'run');

  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.waitForFunction(()=>window.MatsuyamaWalk.debug().avatar.state==='idle',null,{timeout:2000});
  const stopped=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(stopped.state,'idle');

  await page.evaluate(()=>window.MatsuyamaWalk.setView('first'));
  const first=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(first.modelVisible,false,'third-person GLB must hide in first person');

  await page.evaluate(()=>window.MatsuyamaWalk.setView('third'));
  const third=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(third.modelVisible,true);

  await page.screenshot({path:path.join(artifacts,'walk-w2-2-avatar.png'),animations:'disabled',timeout:90000});
  const report={loaded:loaded.avatar,idle,walk,run,stopped,first,third,loop:loaded.loop};
  fs.writeFileSync(path.join(artifacts,'walk-w2-2-debug.json'),JSON.stringify(report,null,2));

  await page.evaluate(()=>window.MatsuyamaWalk.stop());
  assert.equal(await page.evaluate(()=>window.MatsuyamaWalk.debug().loop.rafActive),false);

  const materialErrors=errors.filter(x=>!/favicon|ResizeObserver loop|Failed to load resource/i.test(x));
  assert.deepEqual(materialErrors,[],`browser errors: ${materialErrors.join(' | ')}`);
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
  const mobile=await mobileContext.newPage();
  await mobile.goto(target,{waitUntil:'domcontentloaded',timeout:120000});
  await mobile.waitForFunction(()=>window.__matsuyamaViewer&&window.MatsuyamaWalk?.debug,null,{timeout:120000});
  await mobile.evaluate(()=>window.MatsuyamaWalk.start());
  await mobile.waitForFunction(()=>window.MatsuyamaWalk.debug().avatar.ready,null,{timeout:120000});
  const mobileStart=await mobile.evaluate(()=>window.MatsuyamaWalk.debug());
  assert.equal(mobileStart.performance.mobileProfileActive,true);
  assert.ok(mobileStart.performance.resolutionScale<=0.72);
  assert.equal(mobileStart.performance.shadows,false);
  assert.equal(mobileStart.performance.ambientOcclusion,false);
  await mobile.evaluate(()=>{
    const w=window.MatsuyamaWalk;
    w.setVirtualStick('move',0,.9);
    w.stepControls(1/60,performance.now()+1000);
  });
  const mobileRun=await mobile.evaluate(()=>window.MatsuyamaWalk.debug());
  assert.equal(mobileRun.avatar.state,'run','full mobile stick deflection must select real Running clip');
  await mobile.screenshot({path:path.join(artifacts,'walk-mobile-polish.png'),animations:'disabled',timeout:90000});
  await mobile.evaluate(()=>window.MatsuyamaWalk.stop());
  const mobileStop=await mobile.evaluate(()=>window.MatsuyamaWalk.debug());
  assert.equal(mobileStop.performance.mobileProfileActive,false);
  await mobileContext.close();

  console.log('PASS Walk W2.2 GLB avatar',JSON.stringify({animations:loaded.avatar.animations,states:['idle','walk','run'],renderer:loaded.avatar.renderer,mobile:{resolutionScale:mobileStart.performance.resolutionScale,run:mobileRun.avatar.state}}));
}finally{
  await browser.close();
}
