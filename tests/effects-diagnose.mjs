import {chromium} from 'playwright';
import fs from 'node:fs';
import {stage1Routes} from './stage1-test-support.mjs';
const mode=process.env.STAGE1_EFFECTS||'both';
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
await stage1Routes(page);
await page.route('**/procedural-matsuyama-stage1-streets.js',r=>r.fulfill({body:''}));
page.on('pageerror',e=>console.error('PAGEERROR',e.stack));page.on('console',m=>{if(m.type()==='error')console.error(m.text())});
fs.mkdirSync('e2e-artifacts',{recursive:true});
const phases=[];function save(name,data){phases.push({name,data});fs.writeFileSync(`e2e-artifacts/effects-${mode}.json`,JSON.stringify(phases,null,2));console.log(name,JSON.stringify(data));}
async function bounded(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`stalled ${label}`)),45000)})]);}finally{clearTimeout(timer)}}
try{
 await page.goto('http://127.0.0.1:8000/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.MatsuyamaProceduralStage1?.debug().ready,null,{timeout:150000});save('ready',await page.evaluate(()=>window.MatsuyamaProceduralStage1.debug()));
 await page.evaluate(()=>{const v=window.__matsuyamaViewer;v.camera.lookAt(Cesium.Cartesian3.fromDegrees(132.7658,33.8379,38),new Cesium.HeadingPitchRange(.2,-.42,190));v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);v.scene.requestRender()});
 await page.waitForTimeout(3000);
 save('close',await bounded(page.evaluate(mode=>{const v=window.__matsuyamaViewer;v.shadows=mode==='both'||mode==='shadow';v.scene.postProcessStages.ambientOcclusion.enabled=mode==='both'||mode==='ao';v.scene.requestRender();return window.MatsuyamaProceduralStage1.debug()},mode),'effects'));
 save('frames',await bounded(page.evaluate(()=>new Promise(resolve=>{const start=performance.now(),a=[];let p=start;function tick(t){a.push(t-p);p=t;window.__matsuyamaViewer.scene.requestRender();if(t-start<3000)requestAnimationFrame(tick);else resolve(a)}requestAnimationFrame(tick)})),'frames'));
 const cdp=await page.context().newCDPSession(page);save('capture-start',{});const im=await bounded(cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true}),'capture');fs.writeFileSync(`e2e-artifacts/effects-${mode}.png`,Buffer.from(im.data,'base64'));save('capture-complete',{});
 save('pick',await bounded(page.evaluate(()=>{const start=performance.now();window.__matsuyamaViewer.scene.pick(new Cesium.Cartesian2(640,400));return performance.now()-start}),'pick'));
}catch(e){save('failure',e.stack);process.exitCode=1;}finally{setTimeout(()=>process.exit(process.exitCode||0),5000).unref();await browser.close();}
