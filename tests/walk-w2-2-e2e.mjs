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


// Verify rendered skeletal motion, not merely the selected clip's name.
// Runtime node transforms are inspected only in this test, pinned to Cesium 1.130.
async function expectSkeletalMotion(targetPage, label) {
  const snapshot = () => {
    const w=window.MatsuyamaWalk, model=w.state.avatarModel;
    return {
      avatar:w.debug().avatar,
      joints:(model._sceneGraph?._runtimeNodes||[])
        .filter(n=>n && /arm|leg|thigh|calf|foot/i.test(n.node?.name||''))
        .map(n=>({name:n.node.name,matrix:Cesium.Matrix4.toArray(n.transform)}))
    };
  };
  const before=await targetPage.evaluate(snapshot);
  assert.ok(before.joints.length>=2, label+': no limb joints sampled');
  try {
  await targetPage.waitForFunction(({updates,time})=>{
    const a=window.MatsuyamaWalk.debug().avatar;
    return a.animationUpdates>updates+2 && a.animationTime!==time;
  },{updates:before.avatar.animationUpdates,time:before.avatar.animationTime},{timeout:15000});
  } catch(error) {
    fs.writeFileSync(path.join(artifacts,label.replaceAll(' ','-')+'-failure.json'),JSON.stringify({before,debug:await targetPage.evaluate(()=>window.MatsuyamaWalk.debug()),visibility:await targetPage.evaluate(()=>document.visibilityState)},null,2));
    throw error;
  }
  const after=await targetPage.evaluate(snapshot);
  const changed=after.joints.filter((j,i)=>
    j.matrix.some((v,k)=>Math.abs(v-before.joints[i].matrix[k])>1e-5));
  assert.ok(changed.length>=2,label+': time advanced but limb joints did not change');
  return {before:before.avatar.animationTime,after:after.avatar.animationTime,
    changedJoints:changed.map(j=>j.name)};
}

try{
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.__matsuyamaViewer&&window.MatsuyamaWalk?.debug,null,{timeout:120000});
  // Reproduce the production default: scene clock remains paused throughout.
  await page.evaluate(()=>{window.__matsuyamaViewer.clock.shouldAnimate=false;window.MatsuyamaWalk.start();});
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
  assert.equal(loaded.avatar.modelReady,true);
  assert.equal(loaded.avatar.error,null);
  assert.equal(loaded.avatar.activeCount,1);
  assert.match(loaded.avatar.activeName,/^Idle$/i);

  await page.waitForTimeout(350);
  const idle=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(idle.state,'idle');
  assert.equal(idle.error,null);
  assert.equal(idle.activeCount,1);
  assert.match(idle.activeName,/^Idle$/i);

  assert.equal(loaded.avatar.sceneShouldAnimate,false);
  assert.equal(loaded.avatar.animateWhilePaused,true);
  const idleMotion=await expectSkeletalMotion(page,'desktop idle');

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(350);
  const walk=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(walk.state,'walk');
  assert.equal(walk.modelVisible,true);
  assert.equal(walk.error,null);
  assert.equal(walk.activeCount,1);
  assert.match(walk.activeName,/^Walking$/i);

  const walkingMotion=await expectSkeletalMotion(page,'desktop walking');

  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(350);
  const run=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(run.state,'run');
  assert.equal(run.error,null);
  assert.equal(run.activeCount,1);
  assert.match(run.activeName,/^Running$/i);

  const runningMotion=await expectSkeletalMotion(page,'desktop running');

  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.waitForFunction(()=>window.MatsuyamaWalk.debug().avatar.state==='idle',null,{timeout:2000});
  const stopped=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(stopped.state,'idle');
  assert.equal(stopped.error,null);
  assert.equal(stopped.activeCount,1);
  assert.match(stopped.activeName,/^Idle$/i);

  await page.evaluate(()=>window.MatsuyamaWalk.setView('first'));
  const first=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(first.modelVisible,false,'third-person GLB must hide in first person');

  await page.evaluate(()=>window.MatsuyamaWalk.setView('third'));
  const third=await page.evaluate(()=>window.MatsuyamaWalk.debug().avatar);
  assert.equal(third.modelVisible,true);

  await page.screenshot({path:path.join(artifacts,'walk-w2-2-avatar.png'),animations:'disabled',timeout:90000});
  const report={loaded:loaded.avatar,idle,walk,run,stopped,first,third,loop:loaded.loop,motion:{idleMotion,walkingMotion,runningMotion}};
  fs.writeFileSync(path.join(artifacts,'walk-w2-2-debug.json'),JSON.stringify(report,null,2));

  await page.evaluate(()=>window.MatsuyamaWalk.stop());
  assert.equal(await page.evaluate(()=>window.MatsuyamaWalk.debug().loop.rafActive),false);

  const materialErrors=errors.filter(x=>!/favicon|ResizeObserver loop|Failed to load resource/i.test(x));
  assert.deepEqual(materialErrors,[],`browser errors: ${materialErrors.join(' | ')}`);
  await page.close(); // Release the desktop WebGL scene before the mobile GPU test.
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
  await mobile.evaluate(()=>window.MatsuyamaWalk.setVirtualStick('move',0,.55));
  await mobile.waitForFunction(()=>window.MatsuyamaWalk.debug().avatar.state==='walk');
  const mobilePosition=await mobile.evaluate(()=>({lon:window.MatsuyamaWalk.state.lon,lat:window.MatsuyamaWalk.state.lat}));
  await mobile.waitForFunction(({lon,lat})=>{
    const s=window.MatsuyamaWalk.state;
    return Cesium.Cartesian3.distance(Cesium.Cartesian3.fromDegrees(lon,lat),Cesium.Cartesian3.fromDegrees(s.lon,s.lat))>.1;
  },mobilePosition,{timeout:15000});
  const mobileWalkingMotion=await expectSkeletalMotion(mobile,'mobile walking');
  await mobile.evaluate(()=>{
    const w=window.MatsuyamaWalk;
    w.setVirtualStick('move',0,.9);
    w.stepControls(1/60,performance.now()+1000);
  });
  const mobileRun=await mobile.evaluate(()=>window.MatsuyamaWalk.debug());
  assert.equal(mobileRun.avatar.state,'run','full mobile stick deflection must select real Running clip');
  assert.equal(mobileRun.avatar.error,null);
  assert.equal(mobileRun.avatar.activeCount,1);
  assert.match(mobileRun.avatar.activeName,/^Running$/i);
  const mobileRunningMotion=await expectSkeletalMotion(mobile,'mobile running');
  fs.writeFileSync(path.join(artifacts,'walk-mobile-motion.json'),JSON.stringify({mobileWalkingMotion,mobileRunningMotion},null,2));
  await mobile.screenshot({path:path.join(artifacts,'walk-mobile-polish.png'),animations:'disabled',timeout:90000});
  await mobile.evaluate(()=>window.MatsuyamaWalk.stop());
  const mobileStop=await mobile.evaluate(()=>window.MatsuyamaWalk.debug());
  assert.equal(mobileStop.performance.mobileProfileActive,false);
  await mobileContext.close();

  console.log('PASS Walk W2.2 GLB avatar',JSON.stringify({animations:loaded.avatar.animations,states:['idle','walk','run'],renderer:loaded.avatar.renderer,mobile:{resolutionScale:mobileStart.performance.resolutionScale,run:mobileRun.avatar.state}}));
}finally{
  await browser.close();
}
