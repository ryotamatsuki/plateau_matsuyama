import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const target=(process.argv[2]||'http://127.0.0.1:8000/').replace(/\/?$/,'/');
const artifacts=process.env.E2E_ARTIFACT_DIR||'e2e-artifacts';
fs.mkdirSync(artifacts,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[],lod2Requests=[],textureResponses=[],tileBodies=[];
let tileBodyPending=0;
function gltfJsonFromTile(buffer){
  let glb=buffer;
  if(buffer.subarray(0,4).toString('ascii')==='b3dm'&&buffer.length>=28){
    const offset=28+buffer.readUInt32LE(12)+buffer.readUInt32LE(16)+buffer.readUInt32LE(20)+buffer.readUInt32LE(24);
    glb=buffer.subarray(offset);
  }
  if(glb.length<20||glb.subarray(0,4).toString('ascii')!=='glTF')return null;
  let offset=12;
  while(offset+8<=glb.length){
    const len=glb.readUInt32LE(offset),type=glb.readUInt32LE(offset+4);
    if(type===0x4e4f534a){
      const raw=glb.subarray(offset+8,offset+8+len).toString('utf8').replace(/\\u0000/g,'').trim();
      try{return JSON.parse(raw);}catch{return null;}
    }
    offset+=8+len;
  }
  return null;
}
page.on('pageerror',(e)=>errors.push(e.message));
page.on('console',(m)=>{if(m.type()==='error')errors.push(m.text());});
page.on('request',(r)=>{if(/38201-bldg-lod2-texture-2020|plateau.*lod2/i.test(r.url()))lod2Requests.push(r.url());});
page.on('response',(r)=>{
  const url=r.url();
  if(/_appearance\/.*\.(?:jpg|jpeg|png)(?:\?|$)/i.test(url)&&r.status()<400)textureResponses.push(url);
  if(tileBodies.length+tileBodyPending<8&&/plateau/i.test(url)&&/\.(?:b3dm|glb)(?:\?|$)/i.test(url)&&r.status()<400){
    tileBodyPending++;
    r.body().then((body)=>tileBodies.push({url,body:Buffer.from(body)})).catch(()=>{}).finally(()=>{tileBodyPending--;});
  }
});

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
  const picked=await page.evaluate(async(manifest)=>{
    const v=window.__matsuyamaViewer,C=window.Cesium,seen=new Set(window.MatsuyamaStage2Lod2Poc.debug().seenIds);
    const readId=(f)=>{
      if(!(f instanceof C.Cesium3DTileFeature))return null;
      const props=f.getPropertyIds?.()||[];
      let id=null;
      for(const k of ['gml_id','gml:id','gmlId','id',...props]){
        try{if(f.hasProperty?.(k)){const z=f.getProperty(k);if(z){id=String(z);break;}}}catch(_){}
      }
      let lod=null;
      try{if(f.hasProperty?.('_lod'))lod=Number(f.getProperty('_lod'));}catch(_){}
      return id?{id,props,lod}:null;
    };
    if(typeof v.scene.drillPickFromRayMostDetailed==='function'){
      for(const item of manifest.selected){
        const [lon,lat]=item.centroid;
        const origin=C.Cartesian3.fromDegrees(lon,lat,1200);
        const normal=C.Ellipsoid.WGS84.geodeticSurfaceNormal(origin,new C.Cartesian3());
        const direction=C.Cartesian3.negate(normal,new C.Cartesian3());
        try{
          const hits=await v.scene.drillPickFromRayMostDetailed(new C.Ray(origin,direction),20);
          for(const hit of hits||[]){
            const value=readId(hit?.object||hit);
            if(value&&seen.has(value.id)&&value.lod===2)return value;
          }
        }catch(_){}
      }
    }
    const canvas=v.scene.canvas;
    for(let gy=1;gy<=15;gy++)for(let gx=1;gx<=21;gx++){
      const p=new C.Cartesian2(canvas.clientWidth*gx/22,canvas.clientHeight*gy/16);
      const hits=v.scene.drillPick(p,24)||[];
      for(const hit of hits){
        const value=readId(hit);
        if(value&&seen.has(value.id)&&value.lod===2)return value;
      }
    }
    return null;
  },manifest);
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

  for(let i=0;i<20&&tileBodyPending>0;i++)await new Promise(r=>setTimeout(r,100));
  const gltfs=tileBodies.map(x=>({url:x.url,json:gltfJsonFromTile(x.body)})).filter(x=>x.json);
  const textured=gltfs.filter(x=>Array.isArray(x.json.images)&&x.json.images.length>0);
  assert.ok(textured.length>0||textureResponses.length>0||debug.textureRequests>0,'no texture-bearing LOD2 tile content observed');
  const embeddedTextureImages=textured.reduce((n,x)=>n+x.json.images.filter(im=>Number.isInteger(im.bufferView)).length,0);
  const materialErrors=errors.filter(x=>!/favicon|ResizeObserver loop|Failed to load resource/i.test(x));
  assert.deepEqual(materialErrors,[],`browser errors: ${materialErrors.join(' | ')}`);
  fs.writeFileSync(path.join(artifacts,'stage2-2-debug.json'),JSON.stringify({debug,picked,lod2RequestCount:lod2Requests.length,textureResponseCount:textureResponses.length,tileBodyCount:tileBodies.length,textureBearingTiles:textured.length,embeddedTextureImages},null,2));
  console.log('PASS Stage 2.2 LOD2 POC',JSON.stringify({seenSelected:debug.seenSelected,picked:picked?.id,lod:picked?.lod,lod2Requests:lod2Requests.length,textureResponses:textureResponses.length,textureBearingTiles:textured.length,embeddedTextureImages}));
}finally{
  await browser.close();
}
