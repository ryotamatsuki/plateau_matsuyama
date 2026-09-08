#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(p): return (ROOT / p).read_text(encoding='utf-8')
def write(p, s):
    q = ROOT / p; q.parent.mkdir(parents=True, exist_ok=True); q.write_text(s, encoding='utf-8')
def replace_once(s, old, new, label):
    if old not in s: raise SystemExit(f'patch anchor missing: {label}')
    return s.replace(old, new, 1)

# Shared immutable-data loader.  A single fetch/JSON.parse is shared across app.js,
# immersive-gis.js and water-volume.js; failed promises are evicted for retries.
data_store = r'''\'use strict\';
(function installMatsuyamaDataStore(global) {
  if (global.MatsuyamaData) return;
  const jsonPromises = new Map();
  let buildingRiskPromise = null;
  const waterPromises = new Map();
  const CELL_SIZE = 0.01;
  const abs = (path) => new URL(path, document.baseURI).href;
  function loadJson(path, cache = 'force-cache') {
    const key = abs(path);
    if (jsonPromises.has(key)) return jsonPromises.get(key);
    const promise = fetch(path, { cache }).then((r) => {
      if (!r.ok) throw new Error(`${path} ${r.status}`);
      return r.json();
    }).catch((e) => { jsonPromises.delete(key); throw e; });
    jsonPromises.set(key, promise);
    return promise;
  }
  function buildingRisk() {
    if (buildingRiskPromise) return buildingRiskPromise;
    buildingRiskPromise = loadJson('analysis/building-risk.json').then((raw) => {
      const schema = Object.fromEntries((raw.schema || []).map((name, i) => [name, i]));
      const records = raw.records || [];
      const byId = new Map();
      const cells = new Map();
      const lonIndex = schema.lon, latIndex = schema.lat;
      const idIndexes = [schema.key, schema.sourceId].filter((v, i, a) => v !== undefined && a.indexOf(v) === i);
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        for (const idx of idIndexes) {
          const value = rec[idx];
          if (value !== null && value !== undefined && value !== '') byId.set(String(value), rec);
        }
        const lon = Number(lonIndex === undefined ? NaN : rec[lonIndex]);
        const lat = Number(latIndex === undefined ? NaN : rec[latIndex]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const key = `${Math.floor(lon / CELL_SIZE)},${Math.floor(lat / CELL_SIZE)}`;
        let bucket = cells.get(key);
        if (!bucket) cells.set(key, bucket = []);
        bucket.push(i);
      }
      function queryBounds(west, south, east, north) {
        const out = [];
        const ix0 = Math.floor(west / CELL_SIZE), ix1 = Math.floor(east / CELL_SIZE);
        const iy0 = Math.floor(south / CELL_SIZE), iy1 = Math.floor(north / CELL_SIZE);
        for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) {
          const bucket = cells.get(`${ix},${iy}`);
          if (!bucket) continue;
          for (const index of bucket) {
            const rec = records[index], lon = Number(rec[lonIndex]), lat = Number(rec[latIndex]);
            if (lon >= west && lon <= east && lat >= south && lat <= north) out.push(index);
          }
        }
        out.sort((a, b) => a - b);
        return out.map((i) => records[i]);
      }
      return { raw, schema, byId, cells, cellSize: CELL_SIZE, queryBounds };
    }).catch((e) => { buildingRiskPromise = null; throw e; });
    return buildingRiskPromise;
  }
  function waterScenario(name) {
    if (name !== 'flood' && name !== 'tsunami') return Promise.reject(new Error(`unknown water scenario: ${name}`));
    if (waterPromises.has(name)) return waterPromises.get(name);
    const promise = loadJson(`analysis/water3d/${name}.json`).catch((e) => { waterPromises.delete(name); throw e; });
    waterPromises.set(name, promise);
    return promise;
  }
  global.MatsuyamaData = Object.freeze({ loadJson, buildingRisk, waterScenario });
})(window);
'''
write('docs/data-store.js', data_store)

# Load shared data before the modules that consume it.
index = read('docs/index.html')
index = replace_once(index,
    '<script defer src="gsi-terrain.js"></script><script defer src="walk-mode.js"></script>',
    '<script defer src="gsi-terrain.js"></script><script defer src="data-store.js"></script><script defer src="walk-mode.js"></script>',
    'index data-store')
write('docs/index.html', index)

# app.js: share risk JSON/index, spatially index hazards/selections, and update visible
# features only when their visual generation changes.
app = read('docs/app.js')
old = "  function setBase(){if(base)viewer.imageryLayers.remove(base,true);const v=$('basemap').value;base=viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({url:`https://cyberjapandata.gsi.go.jp/xyz/${v}/{z}/{x}/{y}.${v==='seamlessphoto'?'jpg':'png'}`,maximumLevel:18,credit:new C.Credit('<a href=\"https://maps.gsi.go.jp/development/ichiran.html\" target=\"_blank\">地理院タイル</a>')}),0);render();}"
new = "  function setBase(){const v=$('basemap').value;if(window.MatsuyamaImmersive&&typeof window.MatsuyamaImmersive.setBasemap==='function'){window.MatsuyamaImmersive.setBasemap(v);return;}if(base)viewer.imageryLayers.remove(base,true);base=viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({url:`https://cyberjapandata.gsi.go.jp/xyz/${v}/{z}/{x}/{y}.${v==='seamlessphoto'?'jpg':'png'}`,maximumLevel:18,credit:new C.Credit('<a href=\"https://maps.gsi.go.jp/development/ichiran.html\" target=\"_blank\">地理院タイル</a>')}),0);render();}"
app = replace_once(app, old, new, 'app basemap delegation')
old = "  let analysisManifest=null,riskData=null,riskIndex=null,riskSchema=null,analysisLoading=null;const hazardCache=new Map();"
new = "  let analysisManifest=null,riskData=null,riskIndex=null,riskSchema=null,riskSpatial=null,analysisLoading=null;const hazardCache=new Map(),featureRiskKeyCache=new WeakMap();let buildingVisualEpoch=1;"
app = replace_once(app, old, new, 'app state')
old = "  async function loadRiskData(){if(riskData)return riskData;if(analysisLoading)return analysisLoading;analysisLoading=(async()=>{await loadManifest();const r=await fetch('analysis/building-risk.json',{cache:'force-cache'});if(!r.ok)throw new Error(`building risk ${r.status}`);riskData=await r.json();riskSchema=Object.fromEntries(riskData.schema.map((name,i)=>[name,i]));riskIndex=new Map();for(const rec of riskData.records)riskIndex.set(String(rec[riskSchema.key]),rec);return riskData;})();try{return await analysisLoading;}finally{analysisLoading=null;}}"
new = "  async function loadRiskData(){if(riskData)return riskData;if(analysisLoading)return analysisLoading;analysisLoading=(async()=>{await loadManifest();if(window.MatsuyamaData){const shared=await window.MatsuyamaData.buildingRisk();riskData=shared.raw;riskSchema=shared.schema;riskIndex=shared.byId;riskSpatial=shared;}else{const r=await fetch('analysis/building-risk.json',{cache:'force-cache'});if(!r.ok)throw new Error(`building risk ${r.status}`);riskData=await r.json();riskSchema=Object.fromEntries(riskData.schema.map((name,i)=>[name,i]));riskIndex=new Map();for(const rec of riskData.records)riskIndex.set(String(rec[riskSchema.key]),rec);}buildingVisualEpoch++;return riskData;})();try{return await analysisLoading;}finally{analysisLoading=null;}}"
app = replace_once(app, old, new, 'app shared risk')
old = "  function featureKey(feature){if(!feature)return null;if(riskData&&riskData.idProperty&&feature.hasProperty(riskData.idProperty)){const v=feature.getProperty(riskData.idProperty);if(v!==null&&v!==undefined&&v!==''){const k=String(v);if(riskIndex&&riskIndex.has(k))return k;}}const x=Number(feature.hasProperty('_x')?feature.getProperty('_x'):NaN),y=Number(feature.hasProperty('_y')?feature.getProperty('_y'):NaN);if(Number.isFinite(x)&&Number.isFinite(y)){const k=`xy:${x.toFixed(7)},${y.toFixed(7)}`;if(riskIndex&&riskIndex.has(k))return k;}return null;}"
new = "  function featureKey(feature){if(!feature)return null;if(riskData&&featureRiskKeyCache.has(feature))return featureRiskKeyCache.get(feature);let found=null;if(riskData&&riskData.idProperty&&feature.hasProperty(riskData.idProperty)){const v=feature.getProperty(riskData.idProperty);if(v!==null&&v!==undefined&&v!==''){const k=String(v);if(riskIndex&&riskIndex.has(k))found=k;}}if(!found){const x=Number(feature.hasProperty('_x')?feature.getProperty('_x'):NaN),y=Number(feature.hasProperty('_y')?feature.getProperty('_y'):NaN);if(Number.isFinite(x)&&Number.isFinite(y)){const k=`xy:${x.toFixed(7)},${y.toFixed(7)}`;if(riskIndex&&riskIndex.has(k))found=k;}}if(riskData)featureRiskKeyCache.set(feature,found);return found;}"
app = replace_once(app, old, new, 'app feature key cache')
old = "  function riskColor(rec){const mode=$('riskMode').value;if(mode==='flood'){const rank=Number(rv(rec,'floodRank')||0);return rank?riskColors[`flood${Math.max(1,Math.min(6,rank))}`]:riskColors.none;}if(mode==='tsunami'){const sev=Number(rv(rec,'tsunamiSeverity')||0);return sev?riskColors[`tsunami${Math.max(1,Math.min(9,sev))}`]:riskColors.none;}if(mode==='landslide'){const level=Number(rv(rec,'landslideLevel')||0);return level>=2?riskColors.landslide2:level>=1?riskColors.landslide1:riskColors.none;}return riskColors.neutral;}\n  function passesRiskFilter(rec){const mode=$('riskMode').value,f=$('riskFilter').value;if(f==='all'||mode==='normal')return true;if(!rec)return false;if(mode==='flood')return Number(rv(rec,'floodRank')||0)>=Number(f);if(mode==='tsunami')return Number(rv(rec,'tsunamiSeverity')||0)>0;if(mode==='landslide')return Number(rv(rec,'landslideLevel')||0)>=Number(f);return true;}"
new = "  function riskColor(rec,mode=$('riskMode').value){if(mode==='flood'){const rank=Number(rv(rec,'floodRank')||0);return rank?riskColors[`flood${Math.max(1,Math.min(6,rank))}`]:riskColors.none;}if(mode==='tsunami'){const sev=Number(rv(rec,'tsunamiSeverity')||0);return sev?riskColors[`tsunami${Math.max(1,Math.min(9,sev))}`]:riskColors.none;}if(mode==='landslide'){const level=Number(rv(rec,'landslideLevel')||0);return level>=2?riskColors.landslide2:level>=1?riskColors.landslide1:riskColors.none;}return riskColors.neutral;}\n  function passesRiskFilter(rec,mode=$('riskMode').value,f=$('riskFilter').value){if(f==='all'||mode==='normal')return true;if(!rec)return false;if(mode==='flood')return Number(rv(rec,'floodRank')||0)>=Number(f);if(mode==='tsunami')return Number(rv(rec,'tsunamiSeverity')||0)>0;if(mode==='landslide')return Number(rv(rec,'landslideLevel')||0)>=Number(f);return true;}"
app = replace_once(app, old, new, 'app risk helpers')
old = "  let tileset;\n  function applyTileVisuals(tile){if(!tile||!tile.content)return;const content=tile.content,n=Number(content.featuresLength||0),alpha=Number($('buildingOpacity').value)/100,visible=$('buildings').checked;for(let i=0;i<n;i++){const feature=content.getFeature(i),rec=riskData?riskRecordForFeature(feature):null;feature.show=visible&&passesRiskFilter(rec);feature.color=C.Color.fromCssColorString(riskColor(rec)).withAlpha(alpha);}}\n  function updateStyle(){if(!tileset)return;tileset.show=$('buildings').checked;render();}\n  $('buildings').onchange=updateStyle;$('buildingOpacity').oninput=()=>{$('buildingValue').textContent=`${$('buildingOpacity').value}%`;updateStyle();};"
new = "  let tileset;\n  function invalidateBuildingVisuals(){buildingVisualEpoch++;if(tileset)render();}\n  function applyTileVisuals(tile){if(!tile||!tile.content)return;const content=tile.content;if(content.__matsuyamaAppVisualEpoch===buildingVisualEpoch)return;const n=Number(content.featuresLength||0),alpha=Number($('buildingOpacity').value)/100,visible=$('buildings').checked,mode=$('riskMode').value,filter=$('riskFilter').value,palette=new Map();const colorFor=(css)=>{let c=palette.get(css);if(!c){c=C.Color.fromCssColorString(css).withAlpha(alpha);palette.set(css,c);}return c;};for(let i=0;i<n;i++){const feature=content.getFeature(i),rec=riskData?riskRecordForFeature(feature):null,show=visible&&passesRiskFilter(rec,mode,filter),color=colorFor(riskColor(rec,mode));if(feature.show!==show)feature.show=show;if(!C.Color.equals(feature.color,color))feature.color=color;}content.__matsuyamaAppVisualEpoch=buildingVisualEpoch;}\n  function updateStyle(){if(!tileset)return;tileset.show=$('buildings').checked;invalidateBuildingVisuals();render();}\n  $('buildings').onchange=updateStyle;$('buildingOpacity').oninput=()=>{$('buildingValue').textContent=`${$('buildingOpacity').value}%`;invalidateBuildingVisuals();};"
app = replace_once(app, old, new, 'app tile visual cache')
old = "  $('riskMode').onchange=async()=>{rebuildRiskFilter();try{if($('riskMode').value!=='normal')await loadRiskData();}catch(e){fail(`分析データを読み込めません: ${e.message}`);}updateStyle();};$('riskFilter').onchange=updateStyle;rebuildRiskFilter();loadManifest().catch((e)=>{$('analysisStatus').textContent=`分析データ未接続：${e.message}`;});"
new = "  $('riskMode').onchange=async()=>{rebuildRiskFilter();try{if($('riskMode').value!=='normal')await loadRiskData();}catch(e){fail(`分析データを読み込めません: ${e.message}`);}invalidateBuildingVisuals();updateStyle();};$('riskFilter').onchange=()=>{invalidateBuildingVisuals();updateStyle();};rebuildRiskFilter();loadManifest().catch((e)=>{$('analysisStatus').textContent=`分析データ未接続：${e.message}`;});"
app = replace_once(app, old, new, 'app risk invalidation')
old = "  async function loadHazard(name){if(hazardCache.has(name))return hazardCache.get(name);const r=await fetch(`analysis/hazards/${name}.geojson`,{cache:'force-cache'});if(!r.ok)throw new Error(`${name} ${r.status}`);const data=await r.json(),indexed=data.features.map((f)=>({f,b:geometryBbox(f.geometry)}));hazardCache.set(name,indexed);return indexed;}\n  async function pointHazards(lon,lat){const[flood,tsunami,landslide]=await Promise.all([loadHazard('flood_max'),loadHazard('tsunami'),loadHazard('landslide')]);const hits=(arr)=>arr.filter(({b,f})=>lon>=b[0]&&lon<=b[2]&&lat>=b[1]&&lat<=b[3]&&geomContains(f.geometry,lon,lat)).map((x)=>x.f.properties||{});return{flood:hits(flood),tsunami:hits(tsunami),landslide:hits(landslide)};}"
new = "  async function loadHazard(name){if(hazardCache.has(name))return hazardCache.get(name);const r=await fetch(`analysis/hazards/${name}.geojson`,{cache:'force-cache'});if(!r.ok)throw new Error(`${name} ${r.status}`);const data=await r.json(),cellSize=.01,cells=new Map(),global=[];for(const f of data.features){const b=geometryBbox(f.geometry),item={f,b},ix0=Math.floor(b[0]/cellSize),ix1=Math.floor(b[2]/cellSize),iy0=Math.floor(b[1]/cellSize),iy1=Math.floor(b[3]/cellSize);if((ix1-ix0+1)*(iy1-iy0+1)>64){global.push(item);continue;}for(let ix=ix0;ix<=ix1;ix++)for(let iy=iy0;iy<=iy1;iy++){const key=`${ix},${iy}`;let bucket=cells.get(key);if(!bucket)cells.set(key,bucket=[]);bucket.push(item);}}const indexed={cellSize,cells,global};hazardCache.set(name,indexed);return indexed;}\n  async function pointHazards(lon,lat){const[flood,tsunami,landslide]=await Promise.all([loadHazard('flood_max'),loadHazard('tsunami'),loadHazard('landslide')]);const hits=(index)=>{const key=`${Math.floor(lon/index.cellSize)},${Math.floor(lat/index.cellSize)}`,arr=[...index.global,...(index.cells.get(key)||[])];return arr.filter(({b,f})=>lon>=b[0]&&lon<=b[2]&&lat>=b[1]&&lat<=b[3]&&geomContains(f.geometry,lon,lat)).map((x)=>x.f.properties||{});};return{flood:hits(flood),tsunami:hits(tsunami),landslide:hits(landslide)};}"
app = replace_once(app, old, new, 'app hazard spatial index')
old = "  async function selectByBounds(west,south,east,north,label){await loadRiskData();selectedRecords=riskData.records.filter((r)=>{const lon=Number(rv(r,'lon')),lat=Number(rv(r,'lat'));return lon>=west&&lon<=east&&lat>=south&&lat<=north;});$('selectionStatus').textContent=`${label}｜建物中心点で ${fmt(selectedRecords.length)}棟を選択`;renderSelectionSummary();renderAttributeTable();$('exportCsv').disabled=selectedRecords.length===0;}"
new = "  async function selectByBounds(west,south,east,north,label){await loadRiskData();selectedRecords=riskSpatial&&riskSpatial.queryBounds?riskSpatial.queryBounds(west,south,east,north):riskData.records.filter((r)=>{const lon=Number(rv(r,'lon')),lat=Number(rv(r,'lat'));return lon>=west&&lon<=east&&lat>=south&&lat<=north;});$('selectionStatus').textContent=`${label}｜建物中心点で ${fmt(selectedRecords.length)}棟を選択`;renderSelectionSummary();renderAttributeTable();$('exportCsv').disabled=selectedRecords.length===0;}"
app = replace_once(app, old, new, 'app selection spatial index')
write('docs/app.js', app)

# Terrain: preserve interpolation/fallback/geoid semantics, but resolve unique source tiles
# concurrently before the 65x65 interpolation loop. Keep completed LRU separate from inflight.
gsi = read('docs/gsi-terrain.js')
old = "const geoid=await geoidResponse.json(),maxSourceLevel=Number(manifest.maxZoom||DEFAULT_MAX_SOURCE_LEVEL),cache=new Map(),ranges=manifest.ranges||{},missingTiles=new Set((manifest.missingTiles||[]).map((t)=>`${t.z}/${t.x}/${t.y}`));"
new = "const geoid=await geoidResponse.json(),maxSourceLevel=Number(manifest.maxZoom||DEFAULT_MAX_SOURCE_LEVEL),cache=new Map(),inflight=new Map(),ranges=manifest.ranges||{},missingTiles=new Set((manifest.missingTiles||[]).map((t)=>`${t.z}/${t.x}/${t.y}`));"
gsi = replace_once(gsi, old, new, 'terrain inflight state')
old = "    async function getTile(z,x,y){if(!tileKnownAvailable(z,x,y))return null;const key=`${z}/${x}/${y}`;if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}const promise=decodeTile(`${baseUrl}/dem_png/${z}/${x}/${y}.png`).catch((error)=>{cache.delete(key);throw error;});cache.set(key,promise);while(cache.size>MAX_CACHE_TILES)cache.delete(cache.keys().next().value);return promise;}"
new = "    async function getTile(z,x,y){if(!tileKnownAvailable(z,x,y))return null;const key=`${z}/${x}/${y}`;if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}if(inflight.has(key))return inflight.get(key);const promise=decodeTile(`${baseUrl}/dem_png/${z}/${x}/${y}.png`).then((value)=>{inflight.delete(key);cache.set(key,value);while(cache.size>MAX_CACHE_TILES)cache.delete(cache.keys().next().value);return value;}).catch((error)=>{inflight.delete(key);throw error;});inflight.set(key,promise);return promise;}"
gsi = replace_once(gsi, old, new, 'terrain LRU inflight')
old_start = "callback:async(x,y,level)=>{const output=new Float32Array(TERRAIN_SIZE*TERRAIN_SIZE),n=2**level,preferredLevel=Math.min(level,maxSourceLevel),sourceMemo=new Map();for(let row=0;row<TERRAIN_SIZE;row++){const tv=row/(TERRAIN_SIZE-1),globalY=(y+tv)/n,lat=normalizedYToLatitude(globalY);for(let col=0;col<TERRAIN_SIZE;col++){const tu=col/(TERRAIN_SIZE-1),globalX=(x+tu)/n,lon=globalX*360-180,sourceKey=`${Math.floor(globalX*(2**preferredLevel))}/${Math.floor(globalY*(2**preferredLevel))}`;let sourcePromise=sourceMemo.get(sourceKey);if(!sourcePromise){sourcePromise=sourceForGlobal(globalX,globalY,preferredLevel);sourceMemo.set(sourceKey,sourcePromise);}const source=await sourcePromise;let orthometric=0;if(source){const sn=2**source.z,px=(globalX*sn-source.x)*(SOURCE_SIZE-1),py=(globalY*sn-source.y)*(SOURCE_SIZE-1);orthometric=sampleDem(source.data,px,py);}output[row*TERRAIN_SIZE+col]=orthometric+geoidHeight(geoid,lon,lat);}}return output;}"
new_start = "callback:async(x,y,level)=>{const output=new Float32Array(TERRAIN_SIZE*TERRAIN_SIZE),n=2**level,preferredLevel=Math.min(level,maxSourceLevel),sourceMemo=new Map(),grid=new Array(TERRAIN_SIZE*TERRAIN_SIZE);for(let row=0;row<TERRAIN_SIZE;row++){const tv=row/(TERRAIN_SIZE-1),globalY=(y+tv)/n,lat=normalizedYToLatitude(globalY);for(let col=0;col<TERRAIN_SIZE;col++){const tu=col/(TERRAIN_SIZE-1),globalX=(x+tu)/n,lon=globalX*360-180,sourceKey=`${Math.floor(globalX*(2**preferredLevel))}/${Math.floor(globalY*(2**preferredLevel))}`;if(!sourceMemo.has(sourceKey))sourceMemo.set(sourceKey,sourceForGlobal(globalX,globalY,preferredLevel));grid[row*TERRAIN_SIZE+col]={globalX,globalY,lon,lat,sourceKey};}}const entries=[...sourceMemo.entries()],resolved=new Map(await Promise.all(entries.map(async([key,promise])=>[key,await promise])));for(let i=0;i<grid.length;i++){const g=grid[i],source=resolved.get(g.sourceKey);let orthometric=0;if(source){const sn=2**source.z,px=(g.globalX*sn-source.x)*(SOURCE_SIZE-1),py=(g.globalY*sn-source.y)*(SOURCE_SIZE-1);orthometric=sampleDem(source.data,px,py);}output[i]=orthometric+geoidHeight(geoid,g.lon,g.lat);}return output;}"
gsi = replace_once(gsi, old_start, new_start, 'terrain callback batching')
write('docs/gsi-terrain.js', gsi)

# Immersive: cache scenic classification per feature/content, use shared parsed datasets,
# stop permanent discovery/tuning polling, and let app.js be the single basemap change owner.
imm = read('docs/immersive-gis.js')
old = "    autoWaterSuspended: false, lastBaseError: null\n  };"
new = "    autoWaterSuspended: false, lastBaseError: null, scenicEpoch: 1, scenicFeatureCache: new WeakMap(), walkRiskTimer: 0\n  };"
imm = replace_once(imm, old, new, 'immersive state')
old = "  function scenicColor(feature, alpha) {\n    const t = featureText(feature);\n    let css = '#d7d2c8';\n    if (/(住宅|共同住宅|residential|house|apartment)/.test(t)) css = '#ded3c3';\n    else if (/(商業|店舗|事務所|office|shop|hotel|business)/.test(t)) css = '#d9dde1';\n    else if (/(学校|庁舎|公共|病院|文化|行政|school|hospital|public)/.test(t)) css = '#c9d7dc';\n    else if (/(工場|倉庫|industrial|factory|warehouse)/.test(t)) css = '#aeb5b8';\n    let c = C.Color.fromCssColorString(css);\n    const h = featureHeight(feature);\n    const shade = h >= 40 ? 0.82 : h >= 20 ? 0.89 : h >= 10 ? 0.95 : 1.0;\n    c = new C.Color(c.red * shade, c.green * shade, c.blue * shade, alpha);\n    return c;\n  }\n\n  function applyScenicVisuals(tile) {\n    const scenic = $('buildingScenic'), riskMode = $('riskMode'), opacity = $('buildingOpacity');\n    if (!tile || !tile.content || !riskMode || riskMode.value !== 'normal') return;\n    const alpha = opacity ? Number(opacity.value) / 100 : 0.88;\n    const n = Number(tile.content.featuresLength || 0);\n    for (let i = 0; i < n; i++) {\n      const f = tile.content.getFeature(i);\n      f.color = scenic && scenic.checked ? scenicColor(f, alpha) : C.Color.fromCssColorString('#dde9ef').withAlpha(alpha);\n    }\n  }"
new = "  function scenicBaseColor(feature) {\n    if (state.scenicFeatureCache.has(feature)) return state.scenicFeatureCache.get(feature);\n    const t = featureText(feature);\n    let css = '#d7d2c8';\n    if (/(住宅|共同住宅|residential|house|apartment)/.test(t)) css = '#ded3c3';\n    else if (/(商業|店舗|事務所|office|shop|hotel|business)/.test(t)) css = '#d9dde1';\n    else if (/(学校|庁舎|公共|病院|文化|行政|school|hospital|public)/.test(t)) css = '#c9d7dc';\n    else if (/(工場|倉庫|industrial|factory|warehouse)/.test(t)) css = '#aeb5b8';\n    const c = C.Color.fromCssColorString(css), h = featureHeight(feature);\n    const shade = h >= 40 ? 0.82 : h >= 20 ? 0.89 : h >= 10 ? 0.95 : 1.0;\n    const base = new C.Color(c.red * shade, c.green * shade, c.blue * shade, 1);\n    state.scenicFeatureCache.set(feature, base);\n    return base;\n  }\n\n  function applyScenicVisuals(tile) {\n    const scenic = $('buildingScenic'), riskMode = $('riskMode'), opacity = $('buildingOpacity');\n    if (!tile || !tile.content || !riskMode || riskMode.value !== 'normal') return;\n    const alpha = opacity ? Number(opacity.value) / 100 : 0.88, enabled = !!(scenic && scenic.checked);\n    const signature = `${state.scenicEpoch}:${enabled ? 1 : 0}:${alpha}`;\n    if (tile.content.__matsuyamaScenicSignature === signature) return;\n    const n = Number(tile.content.featuresLength || 0), neutral = C.Color.fromCssColorString('#dde9ef').withAlpha(alpha);\n    for (let i = 0; i < n; i++) {\n      const f = tile.content.getFeature(i), base = enabled ? scenicBaseColor(f) : neutral;\n      const color = enabled ? new C.Color(base.red, base.green, base.blue, alpha) : neutral;\n      if (!C.Color.equals(f.color, color)) f.color = color;\n    }\n    tile.content.__matsuyamaScenicSignature = signature;\n  }"
imm = replace_once(imm, old, new, 'immersive scenic cache')
old = "      const r = await fetch(`analysis/water3d/${scenario}.json`, { cache: 'force-cache' });\n      if (!r.ok) throw new Error(`water risk ${scenario} ${r.status}`);\n      const raw = await r.json();"
new = "      const raw = window.MatsuyamaData ? await window.MatsuyamaData.waterScenario(scenario) : await (async()=>{const r=await fetch(`analysis/water3d/${scenario}.json`,{cache:'force-cache'});if(!r.ok)throw new Error(`water risk ${scenario} ${r.status}`);return r.json();})();"
imm = replace_once(imm, old, new, 'immersive shared water')
old = "  async function loadRiskData() {\n    if (state.riskPromise) return state.riskPromise;\n    state.riskPromise = (async () => {\n      const r = await fetch('analysis/building-risk.json', { cache: 'force-cache' });\n      if (!r.ok) throw new Error(`building risk ${r.status}`);\n      const raw = await r.json();\n      const schema = Object.fromEntries((raw.schema || []).map((name, i) => [name, i]));\n      const byId = new Map();\n      for (const rec of raw.records || []) {\n        for (const name of ['sourceId','key']) {\n          const idx = schema[name], value = idx === undefined ? null : rec[idx];\n          if (value !== null && value !== undefined && value !== '') byId.set(String(value), rec);\n        }\n      }\n      return { raw, schema, byId };\n    })();\n    return state.riskPromise;\n  }"
new = "  async function loadRiskData() {\n    if (state.riskPromise) return state.riskPromise;\n    state.riskPromise = window.MatsuyamaData ? window.MatsuyamaData.buildingRisk() : (async () => {\n      const r = await fetch('analysis/building-risk.json', { cache: 'force-cache' });\n      if (!r.ok) throw new Error(`building risk ${r.status}`);\n      const raw = await r.json(), schema = Object.fromEntries((raw.schema || []).map((name, i) => [name, i])), byId = new Map();\n      for (const rec of raw.records || []) for (const name of ['sourceId','key']) { const idx=schema[name],value=idx===undefined?null:rec[idx];if(value!==null&&value!==undefined&&value!=='')byId.set(String(value),rec); }\n      return { raw, schema, byId };\n    })();\n    return state.riskPromise;\n  }"
imm = replace_once(imm, old, new, 'immersive shared risk')
old = "    const basemap = $('basemap');\n    if (basemap) basemap.addEventListener('change', () => setTimeout(() => installBasemap(basemap.value), 0));\n    const scenic = $('buildingScenic'), opacity = $('buildingOpacity'), risk = $('riskMode');\n    if (scenic) scenic.addEventListener('change', refreshTileset);\n    if (opacity) opacity.addEventListener('input', refreshTileset);\n    if (risk) risk.addEventListener('change', () => setTimeout(refreshTileset, 80));"
new = "    const scenic = $('buildingScenic'), opacity = $('buildingOpacity'), risk = $('riskMode');\n    const invalidateScenic = () => { state.scenicEpoch++; refreshTileset(); };\n    if (scenic) scenic.addEventListener('change', invalidateScenic);\n    if (opacity) opacity.addEventListener('input', invalidateScenic);\n    if (risk) risk.addEventListener('change', () => { state.scenicEpoch++; setTimeout(refreshTileset, 80); });"
imm = replace_once(imm, old, new, 'immersive single basemap owner')
old = "    installBasemap($('basemap') ? $('basemap').value : 'seamlessphoto');\n    syncHazardPresentation(false);\n    setInterval(findAndAttachTileset, 350);\n    setInterval(tuneWaterPrimitives, 1100);\n    setInterval(updateWalkRisk, 650);\n    setTimeout(findAndAttachTileset, 250);\n    setTimeout(updateWalkRisk, 700);\n    window.MatsuyamaImmersive = {\n      refreshBuildings: refreshTileset,"
new = "    installBasemap($('basemap') ? $('basemap').value : 'seamlessphoto');\n    syncHazardPresentation(false);\n    const findTilesetUntilAttached = () => { findAndAttachTileset(); if (!state.tilesetAttached) setTimeout(findTilesetUntilAttached, 350); };\n    setTimeout(findTilesetUntilAttached, 250);\n    const stopWalkRiskLoop = () => { if (state.walkRiskTimer) clearInterval(state.walkRiskTimer); state.walkRiskTimer = 0; };\n    const startWalkRiskLoop = () => { stopWalkRiskLoop(); updateWalkRisk(); state.walkRiskTimer = setInterval(updateWalkRisk, 650); };\n    window.addEventListener('matsuyama-walk-active', (e) => { if (e.detail) startWalkRiskLoop(); else stopWalkRiskLoop(); });\n    if (window.MatsuyamaWalk && window.MatsuyamaWalk.state.active) startWalkRiskLoop();\n    window.MatsuyamaImmersive = {\n      setBasemap: installBasemap,\n      refreshBuildings: refreshTileset,"
imm = replace_once(imm, old, new, 'immersive polling removal')
write('docs/immersive-gis.js', imm)

# Walk mode: retain the exact 30 Hz control/collision cadence and movement/sensitivity,
# but avoid duplicate entity/camera/DOM work when values did not change.
walk = read('docs/walk-mode.js')
old = "      avatar:null, shadow:null, line:null, timer:0, blockedUntil:0,\n      oldInputs:true, oldCollision:true"
new = "      avatar:null, shadow:null, line:null, timer:0, blockedUntil:0, lastSpeedText:'',\n      oldInputs:true, oldCollision:true"
walk = replace_once(walk, old, new, 'walk state')
old = "          state.ground = r[0].height;\n          groundEl.textContent = '地形追従';\n          updateAvatar();"
new = "          state.ground = r[0].height;\n          if(groundEl.textContent!=='地形追従')groundEl.textContent = '地形追従';\n          updateAvatar(); cameraPose();"
walk = replace_once(walk, old, new, 'walk terrain pose')
old = "      updateAvatar();\n      refineTerrain();\n    }"
new = "      refineTerrain();\n    }"
walk = replace_once(walk, old, new, 'walk duplicate avatar')
old = "    function stepControls(dt = 1 / 30) {\n      if (!state.active) return;\n      dt = C.Math.clamp(Number(dt) || 0, 0, .05);\n      const turn = C.Math.toRadians(95);\n      const look = C.Math.toRadians(70);"
new = "    function setSpeedText(text){if(state.lastSpeedText===text)return;state.lastSpeedText=text;speedEl.textContent=text;}\n\n    function stepControls(dt = 1 / 30) {\n      if (!state.active) return;\n      dt = C.Math.clamp(Number(dt) || 0, 0, .05);\n      const turn = C.Math.toRadians(95);\n      const look = C.Math.toRadians(70);\n      let poseChanged=false, avatarChanged=false;"
walk = replace_once(walk, old, new, 'walk dirty flags')
old = "      lookX = C.Math.clamp(lookX, -1, 1);\n      lookY = C.Math.clamp(lookY, -1, 1);\n\n      if (state.view === 'first') {"
new = "      lookX = C.Math.clamp(lookX, -1, 1);\n      lookY = C.Math.clamp(lookY, -1, 1);\n      poseChanged = !!(lookX || lookY);\n\n      if (state.view === 'first') {"
walk = replace_once(walk, old, new, 'walk look dirty')
old = "        speedEl.textContent = `${fast ? '早歩き' : '歩行'} ${speed.toFixed(1)} m/s`;\n        if (!blocked(wd, dist)) move(e, n);\n      } else {\n        speedEl.textContent = '停止';\n      }\n\n      if (performance.now() < state.blockedUntil) speedEl.textContent = '建物前で停止';\n      updateAvatar();\n      cameraPose();"
new = "        setSpeedText(`${fast ? '早歩き' : '歩行'} ${speed.toFixed(1)} m/s`);\n        if (!blocked(wd, dist)) { move(e, n); poseChanged=true; avatarChanged=true; }\n      } else {\n        setSpeedText('停止');\n      }\n\n      if (performance.now() < state.blockedUntil) setSpeedText('建物前で停止');\n      if (avatarChanged) updateAvatar();\n      if (poseChanged) cameraPose();"
walk = replace_once(walk, old, new, 'walk skip unchanged')
old = "      state.active = true;\n      ensureAvatar();"
new = "      state.active = true;\n      state.lastSpeedText='';\n      ensureAvatar();"
walk = replace_once(walk, old, new, 'walk reset HUD')
old = "      stepControls(0);\n    }\n\n    function stop() {"
new = "      stepControls(0);\n      window.dispatchEvent(new CustomEvent('matsuyama-walk-active',{detail:true}));\n    }\n\n    function stop() {"
walk = replace_once(walk, old, new, 'walk start event')
old = "      updateAvatar();\n      viewer.scene.requestRender();\n    }\n\n    function bindStick(zone, kind) {"
new = "      updateAvatar();\n      viewer.scene.requestRender();\n      window.dispatchEvent(new CustomEvent('matsuyama-walk-active',{detail:false}));\n    }\n\n    function bindStick(zone, kind) {"
walk = replace_once(walk, old, new, 'walk stop event')
old = "      let pointerId = null;\n      const update = (e) => {\n        const rect = stick.getBoundingClientRect();"
new = "      let pointerId = null, stickRect = null;\n      const update = (e) => {\n        const rect = stickRect || (stickRect=stick.getBoundingClientRect());"
walk = replace_once(walk, old, new, 'walk stick rect cache')
old = "        pointerId = null;\n        setVirtualStick(kind, 0, 0);"
new = "        pointerId = null; stickRect = null;\n        setVirtualStick(kind, 0, 0);"
walk = replace_once(walk, old, new, 'walk stick rect reset')
old = "        pointerId = e.pointerId;\n        zone.setPointerCapture?.(e.pointerId);"
new = "        pointerId = e.pointerId; stickRect = stick.getBoundingClientRect();\n        zone.setPointerCapture?.(e.pointerId);"
walk = replace_once(walk, old, new, 'walk stick rect start')
walk = walk.replace('      updateAvatar(); cameraPose();\n      e.preventDefault(); e.stopImmediatePropagation();', '      cameraPose();\n      e.preventDefault(); e.stopImmediatePropagation();', 1)
write('docs/walk-mode.js', walk)

# Water: share JSON parse, cache polygon hierarchies, and reuse unchanged spatial/class
# chunks. Changed chunks are swapped only after replacement primitives are ready.
water = read('docs/water-volume.js')
water = replace_once(water, "  let primitives = [];\n  let appearances = [];", "  let primitives = [];\n  let appearances = [];\n  const chunkEntries = new Map();\n  const CHUNK_SIZE = 0.01;", 'water chunk state')
old = "      const r = await fetch(PATHS[name], { cache: 'force-cache' });\n      if (!r.ok) throw new Error(`3D water ${name} ${r.status}`);\n      const raw = await r.json();"
new = "      const raw = window.MatsuyamaData ? await window.MatsuyamaData.waterScenario(name) : await (async()=>{const r=await fetch(PATHS[name],{cache:'force-cache'});if(!r.ok)throw new Error(`3D water ${name} ${r.status}`);return r.json();})();"
water = replace_once(water, old, new, 'water shared json')
old = "  function clearPrimitives() {\n    if (!viewer) return;\n    for (const p of primitives) {\n      try { viewer.scene.primitives.remove(p); } catch (_) {}\n    }\n    primitives = [];\n    appearances = [];\n    viewer.scene.requestRender();\n  }"
new = "  function clearPrimitives() {\n    if (!viewer) return;\n    const all=new Set(primitives);for(const entry of chunkEntries.values()){if(entry.primitive)all.add(entry.primitive);if(entry.pending)all.add(entry.pending);if(entry.old)all.add(entry.old);}\n    for (const p of all) { try { viewer.scene.primitives.remove(p); } catch (_) {} }\n    chunkEntries.clear(); primitives = []; appearances = [];\n    viewer.scene.requestRender();\n  }"
water = replace_once(water, old, new, 'water clear chunks')
old_start = "      const groups = new Map();\n      for (const part of chosen.parts) {"
new_start = "      const groups = new Map();\n      for (const part of chosen.parts) {"
# no-op anchor is intentional; detailed block replaced below
old_block = "        const h = hierarchy(part.rings);\n        if (!h) continue;\n        const geometry = new C.PolygonGeometry({\n          polygonHierarchy: h,\n          height: ground + depth,\n          extrudedHeight: ground - 0.12,\n          closeTop: true,\n          closeBottom: false,\n          vertexFormat: C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,\n          arcType: C.ArcType.GEODESIC,\n        });\n        if (!groups.has(part.cls)) groups.set(part.cls, []);\n        groups.get(part.cls).push(new C.GeometryInstance({ geometry, id: `water3d:${scenario}:${part.id}` }));"
new_block = "        if(!part.__hierarchy)part.__hierarchy=hierarchy(part.rings);\n        const h = part.__hierarchy;\n        if (!h) continue;\n        const geometry = new C.PolygonGeometry({ polygonHierarchy:h,height:ground+depth,extrudedHeight:ground-.12,closeTop:true,closeBottom:false,vertexFormat:C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,arcType:C.ArcType.GEODESIC });\n        const chunk=`${part.cls}:${Math.floor(part.lon/CHUNK_SIZE)},${Math.floor(part.lat/CHUNK_SIZE)}`;\n        if(!groups.has(chunk))groups.set(chunk,{cls:part.cls,ids:[],geometries:[]});\n        const group=groups.get(chunk);group.ids.push(part.id);group.geometries.push(new C.GeometryInstance({geometry,id:`water3d:${scenario}:${part.id}`}));"
water = replace_once(water, old_block, new_block, 'water hierarchy and chunks')
old_swap = "      const old = primitives;\n      primitives = [];\n      appearances = [];\n      const alpha = currentAlpha();\n      let instances = 0;\n      for (const [clsKey, geometries] of groups.entries()) {\n        if (!geometries.length) continue;\n        const cls = data.classes.get(Number(clsKey));\n        const appearance = makeWaterAppearance(cls && cls.color, alpha, scenario === 'tsunami');\n        const primitive = new C.Primitive({\n          geometryInstances: geometries,\n          appearance,\n          asynchronous: true,\n          releaseGeometryInstances: true,\n          allowPicking: false,\n        });\n        viewer.scene.primitives.add(primitive);\n        primitives.push(primitive);\n        instances += geometries.length;\n      }\n      for (const p of old) { try { viewer.scene.primitives.remove(p); } catch (_) {} }"
new_swap = "      const alpha=currentAlpha(),nextKeys=new Set(),nextPrimitives=[],nextAppearances=[];let instances=0;\n      const waitReady=(key,entry,oldPrimitive,seqAtBuild)=>{const check=()=>{if(seqAtBuild!==refreshSeq||!chunkEntries.has(key)||chunkEntries.get(key)!==entry){try{viewer.scene.primitives.remove(entry.pending);}catch(_){}return;}if(entry.pending&&entry.pending.ready){entry.primitive=entry.pending;entry.pending=null;if(oldPrimitive&&oldPrimitive!==entry.primitive){try{viewer.scene.primitives.remove(oldPrimitive);}catch(_){}}viewer.scene.requestRender();}else setTimeout(check,35);};check();};\n      for(const [chunkKey,group] of groups.entries()){if(!group.geometries.length)continue;nextKeys.add(chunkKey);instances+=group.geometries.length;const signature=`${scenario}|${mode}|${group.cls}|${group.ids.slice().sort((a,b)=>a-b).join(',')}`;let entry=chunkEntries.get(chunkKey);if(entry&&entry.signature===signature){nextPrimitives.push(entry.primitive||entry.pending);if(entry.appearance)nextAppearances.push(entry.appearance);continue;}const cls=data.classes.get(Number(group.cls)),appearance=makeWaterAppearance(cls&&cls.color,alpha,scenario==='tsunami'),primitive=new C.Primitive({geometryInstances:group.geometries,appearance,asynchronous:true,releaseGeometryInstances:true,allowPicking:false});viewer.scene.primitives.add(primitive);const oldPrimitive=entry&&(entry.primitive||entry.pending);entry={signature,primitive:null,pending:primitive,appearance};chunkEntries.set(chunkKey,entry);nextPrimitives.push(primitive);nextAppearances.push(appearance);waitReady(chunkKey,entry,oldPrimitive,seq);}\n      for(const [key,entry] of [...chunkEntries.entries()])if(!nextKeys.has(key)){for(const p of [entry.primitive,entry.pending])if(p){try{viewer.scene.primitives.remove(p);}catch(_){}}chunkEntries.delete(key);}\n      primitives=nextPrimitives.filter(Boolean);appearances=nextAppearances;"
water = replace_once(water, old_swap, new_swap, 'water differential swap')
write('docs/water-volume.js', water)

# Add static checks for the new module; perf test/report are created separately by this builder.
ci = read('.github/workflows/ci.yml')
ci = replace_once(ci, "          node --check docs/gsi-terrain.js\n", "          node --check docs/gsi-terrain.js\n          node --check docs/data-store.js\n", 'CI data-store check')
write('.github/workflows/ci.yml', ci)

# Browser benchmark. Raw samples only; all percentiles/deltas are calculated in Python.
perf = r'''import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';
const [baseline,candidate]=process.argv.slice(2);if(!baseline||!candidate)throw new Error('usage: perf.mjs baseline candidate');
const outDir=process.env.PERF_ARTIFACT_DIR||'perf-artifacts';fs.mkdirSync(outDir,{recursive:true});
const results={baseline:{},candidate:{}};
function statsHook(page){return page.addInitScript(()=>{window.__perf={long:[]};try{new PerformanceObserver((list)=>{for(const e of list.getEntries())window.__perf.long.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});}catch(_){}});}
async function waitCore(page,timeout=150000){const t=Date.now();await page.waitForFunction(()=>window.__matsuyamaViewer&&!window.__matsuyamaViewer.isDestroyed(),null,{timeout});await page.waitForFunction(()=>window.MatsuyamaImmersive?.debug().tilesetAttached===true,null,{timeout});await page.waitForFunction(()=>document.querySelector('#terrainStatus')?.textContent.includes('DEM10B'),null,{timeout});await page.waitForFunction(()=>/PLATEAU 2020年度 LOD1|建物表示中/.test(document.querySelector('#buildingStatus')?.textContent||''),null,{timeout});return Date.now()-t;}
async function frameSamples(page,ms=3500){return await page.evaluate(async(ms)=>{const a=[];let last=performance.now(),end=last+ms;while(performance.now()<end){await new Promise(requestAnimationFrame);const now=performance.now();a.push(now-last);last=now;}return a;},ms);}
async function inputSamples(page,n=16){return await page.evaluate(async(n)=>{const out=[],w=window.MatsuyamaWalk;for(let i=0;i<n;i++){const before=w.state.cameraHeading,t=performance.now();w.setVirtualStick('look',.75,0);await new Promise((resolve)=>{const check=()=>{if(Math.abs(w.state.cameraHeading-before)>1e-5)resolve();else requestAnimationFrame(check);};check();});out.push(performance.now()-t);w.setVirtualStick('look',0,0);await new Promise(requestAnimationFrame);}return out;},n);}
async function freezeWater(page){await page.evaluate(()=>{const p=window.__matsuyamaViewer.scene.primitives;for(let i=0;i<p.length;i++){const u=p.get(i)?.appearance?.material?.uniforms;if(u&&'animationSpeed' in u)u.animationSpeed=0;}window.__matsuyamaViewer.scene.requestRender();window.__matsuyamaViewer.render();});}
async function fixedView(page){await page.evaluate(()=>{const v=window.__matsuyamaViewer,C=window.Cesium;v.camera.setView({destination:C.Cartesian3.fromDegrees(132.7657,33.8392,650),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});v.scene.requestRender();});await page.waitForTimeout(5000);}
async function demSamples(page){return await page.evaluate(async()=>{const C=window.Cesium,v=window.__matsuyamaViewer,pts=[[132.7657,33.8392],[132.7863,33.8518],[132.7514,33.8392],[132.715,33.788],[132.718,33.864]].map(([lon,lat])=>C.Cartographic.fromDegrees(lon,lat));const r=await C.sampleTerrainMostDetailed(v.terrainProvider,pts);return r.map(x=>x.height);});}
async function runVariant(browserType,contextOpts,url,label,variant){const browser=browserType==='chromium'?await chromium.launch({headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader']}):await webkit.launch({headless:true});const context=await browser.newContext(contextOpts);const page=await context.newPage();await statsHook(page);const requests=[];page.on('response',r=>requests.push({url:r.url(),status:r.status(),len:Number(r.headers()['content-length']||0)}));const navStart=Date.now();await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});const coldReady=Date.now()-navStart;await waitCore(page);await page.waitForFunction(()=>/^3D水面：/.test(document.querySelector('#water3dStatus')?.textContent||''),null,{timeout:150000});await fixedView(page);const staticFrames=await frameSamples(page);const dem=await demSamples(page);const waterStatus=await page.locator('#water3dStatus').textContent();await freezeWater(page);await page.screenshot({path:path.join(outDir,`${variant}-${label}-scene.png`),animations:'disabled',timeout:90000});await page.evaluate(()=>window.MatsuyamaWalk.start());await page.waitForFunction(()=>window.MatsuyamaWalk?.state?.active===true);await page.waitForTimeout(700);const walkFramesPromise=frameSamples(page);await page.evaluate(()=>window.MatsuyamaWalk.setVirtualStick('move',0,.9));await page.waitForTimeout(2800);await page.evaluate(()=>window.MatsuyamaWalk.setVirtualStick('move',0,0));const walkFrames=await walkFramesPromise;const input=inputSamples(page);const turnFramesPromise=frameSamples(page);await page.evaluate(()=>window.MatsuyamaWalk.setVirtualStick('look',.8,.25));await page.waitForTimeout(2800);await page.evaluate(()=>window.MatsuyamaWalk.setVirtualStick('look',0,0));const turnFrames=await turnFramesPromise;const inputLatency=await input;await page.evaluate(()=>window.MatsuyamaWalk.stop());const longTasks=await page.evaluate(()=>window.__perf.long.slice());const heap=await page.evaluate(()=>performance.memory?performance.memory.usedJSHeapSize:null);const debug=await page.evaluate(()=>window.MatsuyamaImmersive.debug());await page.reload({waitUntil:'domcontentloaded',timeout:120000});const warmReady=await waitCore(page);await browser.close();return{coldReady,warmReady,staticFrames,walkFrames,turnFrames,inputLatency,longTasks,dem,waterStatus,debug,network:{requests:requests.length,contentLength:requests.reduce((s,x)=>s+(x.len||0),0),buildingRiskRequests:requests.filter(x=>x.url.includes('building-risk.json')).length,waterJsonRequests:requests.filter(x=>/water3d\/(flood|tsunami)\.json/.test(x.url)).length},heap};}
const configs=[['chromium',{viewport:{width:1440,height:900},deviceScaleFactor:1},'desktop'],['webkit',{...devices['iPhone 15']},'iphone']];
for(const [browserType,opts,label] of configs){results.baseline[label]=await runVariant(browserType,opts,baseline,label,'baseline');results.candidate[label]=await runVariant(browserType,opts,candidate,label,'candidate');}
fs.writeFileSync(path.join(outDir,'raw.json'),JSON.stringify(results));console.log('PERF RAW COMPLETE');
'''
write('tests/perf.mjs', perf)

summarize = r'''#!/usr/bin/env python3
import json, math, statistics, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
root=Path(sys.argv[1] if len(sys.argv)>1 else 'perf-artifacts'); data=json.loads((root/'raw.json').read_text())
def pct(xs,p):
    xs=sorted(float(x) for x in xs if math.isfinite(float(x)))
    if not xs:return None
    k=(len(xs)-1)*p/100;lo=math.floor(k);hi=math.ceil(k)
    return xs[lo] if lo==hi else xs[lo]*(hi-k)+xs[hi]*(k-lo)
def f(v,d=2):return 'n/a' if v is None else f'{v:.{d}f}'
def metrics(r):
    out={}
    for key in ['staticFrames','walkFrames','turnFrames','inputLatency']:
        xs=r[key];out[key]={'p50':pct(xs,50),'p95':pct(xs,95),'p99':pct(xs,99),'max':max(xs) if xs else None}
    ls=[x['duration'] for x in r['longTasks']];out['long']={'count':len(ls),'total':sum(ls),'max':max(ls) if ls else 0}
    return out
def imgdiff(a,b):
    ia=Image.open(a).convert('RGBA');ib=Image.open(b).convert('RGBA');
    if ia.size!=ib.size:return {'sizeMismatch':True}
    diff=ImageChops.difference(ia,ib); hist=diff.histogram();pixels=ia.width*ia.height
    different=sum(1 for v in diff.getdata() if v!=(0,0,0,0)); mean=sum(ImageStat.Stat(diff).mean[:3])/3
    return {'sizeMismatch':False,'differentPct':different/pixels*100,'meanAbs':mean,'maxChannel':max((i%256 for i,n in enumerate(hist) if n),default=0)}
summary={'baseline':{},'candidate':{},'images':{},'dem':{}}
lines=['# Runtime performance optimization report','','Baseline: `eb9393db71d8982277a7eedf6c155f68a117ac2c`','Candidate: `feature/runtime-performance-no-quality-loss`','','All browser results below are GitHub Actions emulation/headless runs, not physical-device measurements.','']
for device in ['desktop','iphone']:
    b=data['baseline'][device];c=data['candidate'][device];bm=metrics(b);cm=metrics(c);summary['baseline'][device]=bm;summary['candidate'][device]=cm
    demdiff=[abs(float(x)-float(y)) for x,y in zip(b['dem'],c['dem']) if math.isfinite(float(x)) and math.isfinite(float(y))];mx=max(demdiff) if demdiff else None;summary['dem'][device]={'maxAbsMeters':mx}
    img=imgdiff(root/f'baseline-{device}-scene.png',root/f'candidate-{device}-scene.png');summary['images'][device]=img
    lines += [f'## {device}', '', '| metric | baseline | candidate |', '|---|---:|---:|']
    for phase,label in [('staticFrames','frame static'),('walkFrames','frame walk'),('turnFrames','frame turn')]:
        for q in ['p50','p95','p99']:
            lines.append(f'| {label} {q} (ms) | {f(bm[phase][q])} | {f(cm[phase][q])} |')
    for q in ['p50','p95','p99']: lines.append(f'| input latency {q} (ms) | {f(bm["inputLatency"][q])} | {f(cm["inputLatency"][q])} |')
    lines += [f'| long tasks count | {bm["long"]["count"]} | {cm["long"]["count"]} |',f'| long tasks total (ms) | {f(bm["long"]["total"])} | {f(cm["long"]["total"])} |',f'| cold core-ready (ms) | {b["coldReady"]} | {c["coldReady"]} |',f'| warm core-ready (ms) | {b["warmReady"]} | {c["warmReady"]} |',f'| response count | {b["network"]["requests"]} | {c["network"]["requests"]} |',f'| building-risk responses | {b["network"]["buildingRiskRequests"]} | {c["network"]["buildingRiskRequests"]} |',f'| water JSON responses | {b["network"]["waterJsonRequests"]} | {c["network"]["waterJsonRequests"]} |',f'| JS heap (bytes, when exposed) | {b["heap"]} | {c["heap"]} |', '', f'DEM maximum absolute difference: **{f(mx,6)} m**.', f'Frozen-water screenshot difference: **{f(img.get("differentPct"),4)}% pixels**, mean absolute RGB channel difference **{f(img.get("meanAbs"),4)}**.', '']
    if mx is None or mx>1e-4: raise SystemExit(f'DEM regression {device}: {mx}')
    if img.get('sizeMismatch') or img.get('differentPct',100)>2.0: raise SystemExit(f'image regression {device}: {img}')
    if c['debug']['verticalExaggeration']!=b['debug']['verticalExaggeration'] or c['debug']['resolutionScale']!=b['debug']['resolutionScale']: raise SystemExit(f'quality tuning regression {device}')
(root/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));Path('PERFORMANCE_OPTIMIZATION.md').write_text('\n'.join(lines),encoding='utf-8');print('\n'.join(lines))
'''
write('tests/summarize_perf.py', summarize)

print('runtime optimization patch applied')
