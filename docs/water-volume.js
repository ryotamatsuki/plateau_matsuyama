'use strict';

(function installWater3d() {
  if (!window.Cesium || window.__matsuyamaWater3dInstalled) return;
  window.__matsuyamaWater3dInstalled = true;
  const C = Cesium;

  const PATHS = { flood: 'analysis/water3d/flood.json', tsunami: 'analysis/water3d/tsunami.json' };
  const cache = new Map();
  const groundCache = new Map();
  let viewer = null;
  let primitives = [];
  let appearances = [];
  const chunkEntries = new Map();
  const CHUNK_SIZE = 0.01;
  let refreshSeq = 0;
  let refreshTimer = 0;
  let animationTimer = 0;
  let positionTimer = 0;
  let lastBuildCenter = null;

  const ui = {
    enabled: () => document.getElementById('water3dEnabled'),
    scenario: () => document.getElementById('water3dScenario'),
    mode: () => document.getElementById('water3dDepthMode'),
    opacity: () => document.getElementById('water3dOpacity'),
    opacityValue: () => document.getElementById('water3dOpacityValue'),
    status: () => document.getElementById('water3dStatus'),
    hazard: () => document.getElementById('hazard'),
  };

  function status(text, warn = false) {
    const el = ui.status();
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('warn', warn);
  }

  function waitForViewer() {
    if (window.__matsuyamaViewer && !window.__matsuyamaViewer.isDestroyed()) {
      viewer = window.__matsuyamaViewer;
      init();
      return;
    }
    setTimeout(waitForViewer, 80);
  }

  function injectStyle() {
    if (document.getElementById('water3dStyle')) return;
    const style = document.createElement('style');
    style.id = 'water3dStyle';
    style.textContent = `
      .water3d-box{margin-top:12px;padding:10px;border:1px solid #3f6e87;border-radius:8px;background:#102b3f99}
      .water3d-box .water3d-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .water3d-box .water3d-grid label{margin:5px 0 4px}
      .water3d-box .water3d-grid select{min-height:36px;padding:6px 8px}
      .water3d-note{font-size:11.5px;line-height:1.55;color:#bdd4df;margin:8px 0 0}
      .water3d-note strong{color:#9fe5f1}
      @media(max-width:700px){.water3d-box .water3d-grid{grid-template-columns:1fr 1fr}.water3d-note{font-size:11px}}
    `;
    document.head.appendChild(style);
  }

  async function loadScenario(name) {
    if (cache.has(name)) return cache.get(name);
    const promise = (async () => {
      const raw = window.MatsuyamaData ? await window.MatsuyamaData.waterScenario(name) : await (async()=>{const r=await fetch(PATHS[name],{cache:'force-cache'});if(!r.ok)throw new Error(`3D water ${name} ${r.status}`);return r.json();})();
      if (!raw || raw.version !== 1 || !Array.isArray(raw.features)) throw new Error('3D water schema mismatch');
      const classes = new Map(Object.entries(raw.classes || {}).map(([k, v]) => [Number(k), { label: v[0], mid: Number(v[1]), upper: Number(v[2]), color: v[3] }]));
      const parts = [];
      let id = 0;
      for (const feature of raw.features) {
        const cls = Number(feature[0]);
        const type = Number(feature[1]);
        const coords = feature[2];
        if (!classes.has(cls) || !Array.isArray(coords)) continue;
        if (type === 0) addPart(parts, name, id++, cls, coords);
        else if (type === 1) for (const polygon of coords) addPart(parts, name, id++, cls, polygon);
      }
      return { ...raw, classes, parts };
    })();
    cache.set(name, promise);
    try { return await promise; } catch (e) { cache.delete(name); throw e; }
  }

  function addPart(parts, scenario, id, cls, rings) {
    if (!Array.isArray(rings) || !Array.isArray(rings[0]) || rings[0].length < 3) return;
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const p of rings[0]) {
      const lon = Number(p[0]), lat = Number(p[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat);
    }
    if (!Number.isFinite(west)) return;
    const lon = (west + east) / 2, lat = (south + north) / 2;
    const dx = (east - west) * 111320 * Math.cos(C.Math.toRadians(lat));
    const dy = (north - south) * 110540;
    parts.push({ scenario, id, cls, rings, lon, lat, halfDiag: Math.hypot(dx, dy) / 2 });
  }

  function cameraCenter() {
    const carto = viewer.camera.positionCartographic;
    return { lon: C.Math.toDegrees(carto.longitude), lat: C.Math.toDegrees(carto.latitude), h: Math.max(0, carto.height || 0) };
  }

  function radiusForHeight(h) {
    if (h < 100) return 1800;
    if (h < 400) return 3200;
    if (h < 1500) return 5200;
    if (h < 4500) return 8500;
    return 13000;
  }

  function maxPartsForHeight(h) {
    return h < 120 ? 650 : h < 1500 ? 900 : 1150;
  }

  function distanceMeters(aLon, aLat, bLon, bLat) {
    const mid = C.Math.toRadians((aLat + bLat) / 2);
    const dx = (aLon - bLon) * 111320 * Math.cos(mid);
    const dy = (aLat - bLat) * 110540;
    return Math.hypot(dx, dy);
  }

  function selectVisible(parts, center) {
    const radius = radiusForHeight(center.h);
    const maxParts = maxPartsForHeight(center.h);
    const selected = [];
    for (const part of parts) {
      const d = distanceMeters(center.lon, center.lat, part.lon, part.lat);
      const edge = Math.max(0, d - part.halfDiag);
      if (edge <= radius) selected.push([edge, part]);
    }
    selected.sort((a, b) => a[0] - b[0]);
    return { radius, parts: selected.slice(0, maxParts).map((x) => x[1]), limited: selected.length > maxParts };
  }

  async function ensureGround(parts) {
    const missing = [];
    for (const part of parts) {
      const key = `${part.lon.toFixed(6)},${part.lat.toFixed(6)}`;
      part.groundKey = key;
      if (!groundCache.has(key)) missing.push(part);
    }
    const batchSize = 180;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const cartos = batch.map((p) => C.Cartographic.fromDegrees(p.lon, p.lat));
      try {
        const sampled = await C.sampleTerrain(viewer.terrainProvider, 14, cartos);
        for (let j = 0; j < batch.length; j++) {
          const h = sampled[j] && Number(sampled[j].height);
          if (Number.isFinite(h)) groundCache.set(batch[j].groundKey, h);
          else {
            const gh = viewer.scene.globe.getHeight(cartos[j]);
            if (Number.isFinite(gh)) groundCache.set(batch[j].groundKey, gh);
          }
        }
      } catch (_) {
        for (let j = 0; j < batch.length; j++) {
          const gh = viewer.scene.globe.getHeight(cartos[j]);
          if (Number.isFinite(gh)) groundCache.set(batch[j].groundKey, gh);
        }
      }
    }
  }

  function decimateRing(ring, limit = 420) {
    if (!Array.isArray(ring)) return [];
    let source = ring;
    if (ring.length > 2) {
      const a = ring[0], b = ring[ring.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) source = ring.slice(0, -1);
    }
    if (source.length <= limit) return source;
    const step = Math.ceil(source.length / limit);
    const out = [];
    for (let i = 0; i < source.length; i += step) out.push(source[i]);
    if (out.length < 3) return source.slice(0, 3);
    return out;
  }

  function hierarchy(rings) {
    const outer = decimateRing(rings[0]);
    if (outer.length < 3) return null;
    const outerPos = C.Cartesian3.fromDegreesArray(outer.flatMap((p) => [Number(p[0]), Number(p[1])]));
    const holes = [];
    for (let i = 1; i < Math.min(rings.length, 6); i++) {
      const r = decimateRing(rings[i], 220);
      if (r.length < 3) continue;
      holes.push(new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(r.flatMap((p) => [Number(p[0]), Number(p[1])]))));
    }
    return new C.PolygonHierarchy(outerPos, holes);
  }

  function parseColor(css, alpha) {
    const c = C.Color.fromCssColorString(css || '#3fa9d6');
    return new C.Color(c.red, c.green, c.blue, alpha);
  }

  function makeWaterAppearance(css, alpha, tsunami) {
    const base = parseColor(css, alpha);
    const blend = parseColor(css, Math.min(0.88, alpha + 0.20));
    const material = C.Material.fromType('Water');
    material.uniforms.normalMap = C.buildModuleUrl('Assets/Textures/waterNormals.jpg');
    material.uniforms.frequency = tsunami ? 1200.0 : 2200.0;
    material.uniforms.animationSpeed = tsunami ? 0.012 : 0.009;
    material.uniforms.amplitude = tsunami ? 3.5 : 2.0;
    material.uniforms.specularIntensity = 0.65;
    material.uniforms.baseWaterColor = base;
    material.uniforms.blendColor = blend;
    const appearance = new C.MaterialAppearance({ material, translucent: true, closed: false, faceForward: true });
    appearance.__waterCss = css;
    appearances.push(appearance);
    return appearance;
  }

  function clearPrimitives() {
    if (!viewer) return;
    const all=new Set(primitives);for(const entry of chunkEntries.values()){if(entry.primitive)all.add(entry.primitive);if(entry.pending)all.add(entry.pending);if(entry.old)all.add(entry.old);}
    for (const p of all) { try { viewer.scene.primitives.remove(p); } catch (_) {} }
    chunkEntries.clear(); primitives = []; appearances = [];
    viewer.scene.requestRender();
  }

  function currentAlpha() {
    const el = ui.opacity();
    return el ? Math.max(0.08, Math.min(0.85, Number(el.value) / 100)) : 0.42;
  }

  function updateOpacity() {
    const alpha = currentAlpha();
    const out = ui.opacityValue();
    if (out) out.textContent = `${Math.round(alpha * 100)}%`;
    for (const app of appearances) {
      const css = app.__waterCss || '#3fa9d6';
      app.material.uniforms.baseWaterColor = parseColor(css, alpha);
      app.material.uniforms.blendColor = parseColor(css, Math.min(0.88, alpha + 0.20));
    }
    if (viewer) viewer.scene.requestRender();
  }

  async function renderWater(reason = 'refresh') {
    if (!viewer || !ui.enabled() || !ui.enabled().checked) { clearPrimitives(); return; }
    const seq = ++refreshSeq;
    const scenario = ui.scenario() ? ui.scenario().value : 'flood';
    const mode = ui.mode() ? ui.mode().value : 'mid';
    status(`${scenario === 'flood' ? '洪水' : '津波'}3D水面を準備中…`);
    try {
      const data = await loadScenario(scenario);
      const center = cameraCenter();
      const chosen = selectVisible(data.parts, center);
      await ensureGround(chosen.parts);
      if (seq !== refreshSeq || !ui.enabled().checked) return;

      const groups = new Map();
      for (const part of chosen.parts) {
        const ground = groundCache.get(part.groundKey);
        if (!Number.isFinite(ground)) continue;
        const cls = data.classes.get(part.cls);
        if (!cls) continue;
        const depth = Number(mode === 'upper' ? cls.upper : cls.mid);
        if (!(depth > 0)) continue;
        if(!part.__hierarchy)part.__hierarchy=hierarchy(part.rings);
        const h = part.__hierarchy;
        if (!h) continue;
        const geometry = new C.PolygonGeometry({ polygonHierarchy:h,height:ground+depth,extrudedHeight:ground-.12,closeTop:true,closeBottom:false,vertexFormat:C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,arcType:C.ArcType.GEODESIC });
        const chunk=`${part.cls}:${Math.floor(part.lon/CHUNK_SIZE)},${Math.floor(part.lat/CHUNK_SIZE)}`;
        if(!groups.has(chunk))groups.set(chunk,{cls:part.cls,ids:[],geometries:[]});
        const group=groups.get(chunk);group.ids.push(part.id);group.geometries.push(new C.GeometryInstance({geometry,id:`water3d:${scenario}:${part.id}`}));
      }
      if (seq !== refreshSeq) return;

      const alpha=currentAlpha(),nextKeys=new Set(),nextPrimitives=[],nextAppearances=[];let instances=0;
      const waitReady=(key,entry,oldPrimitive,seqAtBuild)=>{const check=()=>{if(seqAtBuild!==refreshSeq||!chunkEntries.has(key)||chunkEntries.get(key)!==entry){try{viewer.scene.primitives.remove(entry.pending);}catch(_){}return;}if(entry.pending&&entry.pending.ready){entry.primitive=entry.pending;entry.pending=null;if(oldPrimitive&&oldPrimitive!==entry.primitive){try{viewer.scene.primitives.remove(oldPrimitive);}catch(_){}}viewer.scene.requestRender();}else setTimeout(check,35);};check();};
      for(const [chunkKey,group] of groups.entries()){if(!group.geometries.length)continue;nextKeys.add(chunkKey);instances+=group.geometries.length;const signature=`${scenario}|${mode}|${group.cls}|${group.ids.slice().sort((a,b)=>a-b).join(',')}`;let entry=chunkEntries.get(chunkKey);if(entry&&entry.signature===signature){nextPrimitives.push(entry.primitive||entry.pending);if(entry.appearance)nextAppearances.push(entry.appearance);continue;}const cls=data.classes.get(Number(group.cls)),appearance=makeWaterAppearance(cls&&cls.color,alpha,scenario==='tsunami'),primitive=new C.Primitive({geometryInstances:group.geometries,appearance,asynchronous:true,releaseGeometryInstances:true,allowPicking:false});viewer.scene.primitives.add(primitive);const oldPrimitive=entry&&(entry.primitive||entry.pending);entry={signature,primitive:null,pending:primitive,appearance};chunkEntries.set(chunkKey,entry);nextPrimitives.push(primitive);nextAppearances.push(appearance);waitReady(chunkKey,entry,oldPrimitive,seq);}
      for(const [key,entry] of [...chunkEntries.entries()])if(!nextKeys.has(key)){for(const p of [entry.primitive,entry.pending])if(p){try{viewer.scene.primitives.remove(p);}catch(_){}}chunkEntries.delete(key);}
      primitives=nextPrimitives.filter(Boolean);appearances=nextAppearances;
      lastBuildCenter = center;
      const km = (chosen.radius / 1000).toFixed(1);
      const limited = chosen.limited ? '（近傍LOD上限）' : '';
      const depthText = mode === 'upper' ? '区分上限値・保守表示' : '区分代表値';
      const stale = scenario === 'tsunami' ? '／旧A40参考' : '';
      status(`3D水面：${instances.toLocaleString('ja-JP')}区画・半径${km}km${limited}／${depthText}／鉛直1:1${stale}`, scenario === 'tsunami');
      viewer.scene.requestRender();
    } catch (e) {
      clearPrimitives();
      status(`3D水面を表示できません：${e.message}`, true);
    }
  }

  function scheduleRefresh(delay = 180) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => renderWater('camera'), delay);
  }

  function startAnimation() {
    if (animationTimer) return;
    animationTimer = setInterval(() => {
      if (viewer && ui.enabled() && ui.enabled().checked && primitives.length) viewer.scene.requestRender();
    }, 90);
  }

  function stopAnimationIfDisabled() {
    if (ui.enabled() && ui.enabled().checked) return;
    if (animationTimer) clearInterval(animationTimer);
    animationTimer = 0;
  }

  function init() {
    injectStyle();
    const enabled = ui.enabled(), scenario = ui.scenario(), mode = ui.mode(), opacity = ui.opacity(), hazard = ui.hazard();
    if (!enabled || !scenario || !mode || !opacity) return;
    updateOpacity();

    enabled.addEventListener('change', () => {
      if (enabled.checked) { startAnimation(); renderWater('enable'); }
      else { ++refreshSeq; clearPrimitives(); status('3D水面：非表示'); stopAnimationIfDisabled(); }
    });
    scenario.addEventListener('change', () => renderWater('scenario'));
    mode.addEventListener('change', () => renderWater('depth-mode'));
    opacity.addEventListener('input', updateOpacity);
    if (hazard) hazard.addEventListener('change', () => {
      if (hazard.value === 'flood' || hazard.value === 'tsunami') {
        scenario.value = hazard.value;
        if (enabled.checked) renderWater('hazard-sync');
      }
    });
    viewer.camera.moveEnd.addEventListener(() => { if (enabled.checked) scheduleRefresh(250); });

    positionTimer = setInterval(() => {
      if (!enabled.checked || !lastBuildCenter) return;
      const c = cameraCenter();
      const moved = distanceMeters(c.lon, c.lat, lastBuildCenter.lon, lastBuildCenter.lat);
      const threshold = c.h < 120 ? 550 : 1200;
      if (moved > threshold) scheduleRefresh(20);
    }, 1800);

    if (enabled.checked) { startAnimation(); setTimeout(() => renderWater('initial'), 700); }
    else status('3D水面：非表示');

    window.__matsuyamaWater3d = {
      refresh: () => renderWater('api'),
      clear: clearPrimitives,
      get enabled() { return enabled.checked; },
      get scenario() { return scenario.value; },
    };
  }

  waitForViewer();
})();
