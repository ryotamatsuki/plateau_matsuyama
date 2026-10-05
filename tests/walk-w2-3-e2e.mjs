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
  await page.waitForFunction(()=>window.__matsuyamaViewer&&window.MatsuyamaWalk?.debug&&window.MatsuyamaTerrain,null,{timeout:120000});
  await page.evaluate(()=>window.MatsuyamaWalk.start());
  await page.waitForFunction(()=>window.MatsuyamaWalk.debug().collision.ready,null,{timeout:30000});
  await page.waitForFunction(()=>window.MatsuyamaWalk.debug().terrain.cachedSampler&&window.MatsuyamaWalk.debug().terrain.warmCache,null,{timeout:30000});

  const index=await page.evaluate(()=>fetch('walk-colliders-stage1.json').then(r=>r.json()));
  assert.equal(index.buildings.length,1572);
  assert.deepEqual(index.bbox,[132.76,33.8345,132.7712,33.8441]);

  const first=index.buildings[0];
  const center=[(first[0]+first[2])/2,(first[1]+first[3])/2];
  const blocked=await page.evaluate(([lon,lat])=>window.MatsuyamaWalk.debugCollisionAt(lon,lat),center);
  assert.equal(blocked,true,'building center must be blocked by local CPU collider');

  const outside=await page.evaluate(()=>window.MatsuyamaWalk.debugCollisionAt(132.90,33.90));
  assert.equal(outside,null,'outside local collider coverage must return null/fallback');

  // Find a safe point inside coverage at least ~2 m from all envelopes.
  const safe=await page.evaluate(async()=>{
    const data=await fetch('walk-colliders-stage1.json').then(r=>r.json());
    const latScale=111320;
    for(let iy=1;iy<18;iy++){
      for(let ix=1;ix<18;ix++){
        const lon=data.bbox[0]+(data.bbox[2]-data.bbox[0])*ix/19;
        const lat=data.bbox[1]+(data.bbox[3]-data.bbox[1])*iy/19;
        const lonScale=latScale*Math.cos(lat*Math.PI/180);
        let near=false;
        for(const b of data.buildings){
          const nx=Math.max(b[0],Math.min(lon,b[2]));
          const ny=Math.max(b[1],Math.min(lat,b[3]));
          const dx=(lon-nx)*lonScale,dy=(lat-ny)*latScale;
          if(dx*dx+dy*dy<4){near=true;break;}
        }
        if(!near)return{lon,lat};
      }
    }
    return null;
  });
  assert.ok(safe,'safe local-collider test point not found');

  await page.evaluate(({lon,lat})=>{
    const w=window.MatsuyamaWalk;
    w.state.lon=lon; w.state.lat=lat;
    w.state.ground=60;
  },safe);
  await page.evaluate(()=>window.MatsuyamaTerrain.warmHeightCache(window.MatsuyamaWalk.state.lon,window.MatsuyamaWalk.state.lat,90));
  await page.waitForFunction(()=>Number.isFinite(window.MatsuyamaWalk.debugTerrainAt(window.MatsuyamaWalk.state.lon,window.MatsuyamaWalk.state.lat)),null,{timeout:30000});

  const localMove=await page.evaluate(()=>{
    const w=window.MatsuyamaWalk, scene=window.__matsuyamaViewer.scene;
    const original=scene.pickFromRay; let rays=0;
    scene.pickFromRay=function(...args){rays++;return original.apply(this,args);};
    const before=w.debug();
    w.setVirtualStick('move',0,1);
    for(let i=0;i<8;i++)w.stepControls(1/60,performance.now()+i*17);
    w.setVirtualStick('move',0,0);
    const after=w.debug();
    scene.pickFromRay=original;
    return{rays,before,after};
  });
  assert.equal(localMove.rays,0,'local collider coverage should not call scene.pickFromRay');
  assert.ok(localMove.after.loop.localColliderChecks>localMove.before.loop.localColliderChecks,'local collider was not exercised');
  assert.ok(localMove.after.loop.terrainCachedHits>localMove.before.loop.terrainCachedHits,'cached terrain sampler was not used during local movement');

  const fallback=await page.evaluate(()=>{
    const w=window.MatsuyamaWalk,scene=window.__matsuyamaViewer.scene;
    w.state.lon=132.90;w.state.lat=33.90;w.state.ground=50;
    const original=scene.pickFromRay;let rays=0;
    scene.pickFromRay=function(){rays++;return undefined;};
    w.state.lastCollision=-Infinity;
    w.setVirtualStick('move',0,1);
    w.stepControls(1/60,performance.now()+5000);
    w.setVirtualStick('move',0,0);
    scene.pickFromRay=original;
    return{rays,debug:w.debug()};
  });
  assert.ok(fallback.rays>=1,'outside local coverage should use 3D ray fallback');
  assert.ok(fallback.debug.loop.rayFallbackChecks>=1);

  await page.screenshot({path:path.join(artifacts,'walk-w2-3.png'),animations:'disabled',timeout:90000});
  fs.writeFileSync(path.join(artifacts,'walk-w2-3-debug.json'),JSON.stringify({safe,localMove,fallback},null,2));
  await page.evaluate(()=>window.MatsuyamaWalk.stop());

  const materialErrors=errors.filter(x=>!/favicon|ResizeObserver loop|Failed to load resource/i.test(x));
  assert.deepEqual(materialErrors,[],`browser errors: ${materialErrors.join(' | ')}`);
  console.log('PASS Walk W2.3 local collision + terrain cache',JSON.stringify({
    colliders:index.buildings.length,
    localRayCalls:localMove.rays,
    cachedTerrainHits:localMove.after.loop.terrainCachedHits,
    fallbackRayCalls:fallback.rays
  }));
}finally{
  await browser.close();
}
