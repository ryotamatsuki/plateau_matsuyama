import {chromium} from 'playwright';
import {stage1Routes} from './stage1-test-support.mjs';
import fs from 'node:fs';
fs.mkdirSync('e2e-artifacts',{recursive:true});
const mode=process.env.STAGE1_MODE||'on';
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on('pageerror',e=>console.log('PAGEERROR',e.stack));page.on('console',m=>{if(['error','warning'].includes(m.type()))console.log(m.type(),m.text())});
page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()));
await stage1Routes(page);
await page.addInitScript(()=>{
 window.__stage1Diagnostics={tiles:0,failures:[],renders:[],firstTile:null,initial:null,longTasks:[]};
 try{new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__stage1Diagnostics.longTasks.push({start:e.startTime,duration:e.duration}))).observe({type:'longtask',buffered:true});}catch(_){}
 const timer=setInterval(()=>{const v=window.__matsuyamaViewer;if(!v)return;
 if(!v.__diag){v.__diag=true;v.scene.renderError.addEventListener((s,e)=>{window.__stage1Diagnostics.renders.push(String(e));console.error('RENDER',e.stack)});}
 for(let i=0;i<v.scene.primitives.length;i++){const t=v.scene.primitives.get(i);if(!(t instanceof Cesium.Cesium3DTileset)||t.__diag)continue;t.__diag=true;t.tileFailed.addEventListener(e=>{window.__stage1Diagnostics.failures.push(e);console.error('TILEFAILED',JSON.stringify(e))});t.tileVisible.addEventListener(()=>{const d=window.__stage1Diagnostics;d.tiles++;d.firstTile??=performance.now()});t.initialTilesLoaded.addEventListener(()=>{window.__stage1Diagnostics.initial=performance.now();console.log('INITIALTILES')});}
 },100);
});
try{
 await page.goto(process.argv[2]||'http://127.0.0.1:8000/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForFunction(()=>window.__matsuyamaViewer,null,{timeout:60000});
 for(let i=0;i<12;i++){await page.waitForTimeout(5000);console.log(mode,i,await page.evaluate(()=>({building:document.querySelector('#buildingStatus').textContent,stage:window.MatsuyamaProceduralStage1?.debug(),diag:window.__stage1Diagnostics,entities:window.__matsuyamaViewer.entities.values.length})));if(await page.evaluate(()=>window.__stage1Diagnostics.initial!==null))break;}
 try { await page.screenshot({path:`e2e-artifacts/diagnose-${mode}.png`,timeout:90000,animations:'disabled'}); } catch(e) { console.warn('diagnostic screenshot',e.message); }
 await page.locator('#sheltersEnabled').scrollIntoViewIfNeeded();console.log('HIT',await page.locator('#sheltersEnabled').evaluate(el=>{let b=el.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;return{box:b.toJSON(),hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,300),scroll:document.querySelector('#panel').scrollTop}}));
 await page.screenshot({path:`e2e-artifacts/click-${mode}.png`,timeout:90000,animations:'disabled'});
 try{await page.check('#sheltersEnabled',{timeout:15000});console.log('CLICK PASS')}catch(e){console.log('CLICK FAIL',e.message)}
 console.log('FINAL',JSON.stringify(await page.evaluate(()=>window.__stage1Diagnostics)));
}catch(e){console.log('DIAGFAIL',e.stack)}finally{await browser.close()}
