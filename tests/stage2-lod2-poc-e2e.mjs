import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const target=(process.argv[2]||'http://127.0.0.1:8000/').replace(/\/?$/,'/');
const artifacts=process.env.E2E_ARTIFACT_DIR||'e2e-artifacts';
fs.mkdirSync(artifacts,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[],lod2Requests=[],textureResponses=[];
page.on('pageerror',(e)=>errors.push(e.message));
page.on('console',(m)=>{if(m.type()==='error')errors.push(m.text());});
page.on('request',(r)=>{if(/38201-bldg-lod2-texture-2020|plateau.*lod2/i.test(r.url()))lod2Requests.push(r.url());});
page.on('response',(r)=>{if(/_appearance\/.*\.(?:jpg|jpeg|png)(?:\?|$)/i.test(r.url())&&r.status()<400)textureResponses.push(r.url());});

try{
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.__matsuyamaViewer&&!window.__matsuyamaViewer.isDestroyed(),null,{timeout:120000});
  await page.waitForFunction(()=>window.MatsuyamaStage2Lod2Poc&&document.querySelector('#stage2Lod2Poc'),null,{timeout:30000});
  await page.waitForFunction(()=>/PLATEAU 2020年度 LOD1|建物表示中/.test(document.querySelector('#buildingStatus')?.textContent||''),null,{timeout:120000});
  assert.equal(lod2Requests.length,0,'LOD2 must not load before explicit opt-in');
  if(await page.isChecked('#proceduralStage1'))await page.uncheck('#proceduralStage1');

  const manifest=await page.evaluate(()=>fetch('stage2-lod2-poc-manifest.json').then(r=>r.json()));
  assert.equal(manifest.buildingCount,36);
  assert.equal(manifest.selected.length,36);
  assert.equal(new Set(manifest.selected.map(x=>x.gml_id)).size,36);
  assert.equal(manifest.selected.filter(x=>x.sloped_roof).length,13);

  await page.check('#stage2Lod2Poc');
  await page.waitForFunction(()=>window.MatsuyamaStage2Lod2Poc.debug().loaded||window.MatsuyamaStage2Lod2Poc.debug().failed,null,{timeout:120000});
  let debug=await page.evaluate(()=>window.MatsuyamaStage2Lod2Poc.debug());
  assert.equal(debug.failed,false,`LOD2 load failed: ${debug.lastError}`);
  assert.equal(debug.selectedCount,36);
  assert.ok(lod2Requests.length>0,'official LOD2 endpoint was not requested');

  await page.evaluate(()=>window.MatsuyamaStage2Lod2Poc.flyToPilot());
  await page.waitForTimeout(2500);
  await page.waitForFunction(()=>{
    const d=window.MatsuyamaStage2Lod2Poc.debug();
    return d.show&&d.seenSelected>=3;
  },null,{timeout:120000});
  debug=await page.evaluate(()=>window.MatsuyamaStage2Lod2Poc.debug());
  assert.ok(debug.propertyIds.some(x=>/gml.*id/i.test(x)),`gml id property not found: ${debug.propertyIds.join(',')}`);
  assert.ok(debug.seenSelected>=3,`too few selected LOD2 features observed: ${debug.seenSelected}`);
  assert.equal(debug.comparisonActive,true);
  assert.equal(await page.inputValue('#buildingOpacity'),'32');

  await page.screenshot({path:path.join(artifacts,'stage2-2-lod2-on.png'),animations:'disabled',timeout:90000});
  fs.writeFileSync(path.join(artifacts,'stage2-2-before-pick.json'),JSON.stringify({debug,lod2RequestCount:lod2Requests.length,textureResponseCount:textureResponses.length},null,2));
  const picked=await page.evaluate(()=>{
    const v=window.__matsuyamaViewer,C=window.Cesium,seen=new Set(window.MatsuyamaStage2Lod2Poc.debug().seenIds);
    const canvas=v.scene.canvas;
    const readId=(f)=>{
      if(!(f instanceof C.Cesium3DTileFeature))return null;
      const props=f.getPropertyIds?.()||[];
      for(const k of ['gml_id','gml:id','gmlId','id',...props]){
        try{if(f.hasProperty?.(k)){const z=f.getProperty(k);if(z)return{id:String(z),props};}}catch(_){}
      }
      return null;
    };
    for(let gy=1;gy<=11;gy++)for(let gx=1;gx<=15;gx++){
      const p=new C.Cartesian2(canvas.clientWidth*gx/16,canvas.clientHeight*gy/12);
      const hits=v.scene.drillPick(p,16)||[];
      for(const hit of hits){
        const value=readId(hit);
        if(value&&seen.has(value.id))return value;
      }
    }
    return null;
  });
  assert.ok(picked,'could not drillPick a selected LOD2 building');

  await page.selectOption('#riskMode','flood');
  await page.waitForTimeout(300);
  debug=await page.evaluate(()=>window.MatsuyamaStage2Lod2Poc.debug());
  assert.equal(debug.show,false,'LOD2 POC must yield to risk rendering');
  assert.equal(debug.comparisonActive,false);
  assert.equal(await page.inputValue('#buildingOpacity'),'88');

  await page.selectOption('#riskMode','normal');
  await page.waitForFunction(()=>window.MatsuyamaStage2Lod2Poc.debug().show,null,{timeout:30000});
  assert.equal(await page.inputValue('#buildingOpacity'),'32');

  await page.uncheck('#stage2Lod2Poc');
  await page.waitForTimeout(200);
  debug=await page.evaluate(()=>window.MatsuyamaStage2Lod2Poc.debug());
  assert.equal(debug.show,false);
  assert.equal(debug.comparisonActive,false);
  assert.equal(await page.inputValue('#buildingOpacity'),'88');
  await page.screenshot({path:path.join(artifacts,'stage2-2-lod2-off-restored.png'),animations:'disabled',timeout:90000});

  assert.ok(textureResponses.length>0||debug.textureRequests>0,'no LOD2 appearance texture requests observed');
  const materialErrors=errors.filter(x=>!/favicon|ResizeObserver loop|Failed to load resource/i.test(x));
  assert.deepEqual(materialErrors,[],`browser errors: ${materialErrors.join(' | ')}`);
  fs.writeFileSync(path.join(artifacts,'stage2-2-debug.json'),JSON.stringify({debug,picked,lod2RequestCount:lod2Requests.length,textureResponseCount:textureResponses.length},null,2));
  console.log('PASS Stage 2.2 LOD2 POC',JSON.stringify({seenSelected:debug.seenSelected,picked:picked?.id,lod2Requests:lod2Requests.length,textures:textureResponses.length}));
}finally{
  await browser.close();
}
