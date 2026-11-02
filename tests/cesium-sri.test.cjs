const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('docs/index.html','utf8');
test('versioned Cesium script and CSS are SHA384 pinned',()=>{
 assert.ok(!html.includes('https://cesium.com/downloads/cesiumjs/releases/1.130/'));
 const base='https://cdn.jsdelivr.net/npm/cesium@1.130.0/Build/Cesium/';
 for(const asset of ['Cesium.js','Widgets/widgets.css']){
  const tag=html.split(/></).find(x=>x.includes(base+asset));
  assert.ok(tag,'Asset tag not found: '+asset);
  assert.match(tag,/integrity="sha384-[A-Za-z0-9+/=]+"/);
  assert.match(tag,/crossorigin="anonymous"/);
 }
 assert.ok(html.includes("window.CESIUM_BASE_URL='"+base+"'"));
});
