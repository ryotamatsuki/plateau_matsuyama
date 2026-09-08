'use strict';

(function installImmersiveMatsuyamaGIS() {
  if (!window.Cesium || window.__matsuyamaImmersiveInstalled) return;
  window.__matsuyamaImmersiveInstalled = true;
  const C = Cesium;
  const $ = (id) => document.getElementById(id);
  const isMobile = matchMedia('(pointer:coarse)').matches || window.innerWidth <= 700;
  const GSI_RECTANGLE = C.Rectangle.fromDegrees(122.0, 20.0, 154.0, 46.0);
  const BASEMAPS = {
    seamlessphoto: {
      label: '国土地理院 全国最新写真（シームレス）',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
      minimumLevel: 2, maximumLevel: 18,
      brightness: 1.05, contrast: 1.04, saturation: 0.94, gamma: 1.02,
      note: '撮影時期は地点により異なります。'
    },
    pale: {
      label: '国土地理院 淡色地図',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
      minimumLevel: 2, maximumLevel: 18,
      brightness: 1.02, contrast: 0.99, saturation: 0.90, gamma: 1.0,
      note: '航空写真へ戻すと実景の位置関係を確認できます。'
    },
    std: {
      label: '国土地理院 標準地図',
      url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
      minimumLevel: 2, maximumLevel: 18,
      brightness: 1.0, contrast: 1.0, saturation: 0.96, gamma: 1.0,
      note: '航空写真へ戻すと実景の位置関係を確認できます。'
    }
  };
  const state = {
    viewer: null, baseLayer: null, baseKind: 'seamlessphoto', tileset: null,
    tilesetAttached: false, drapeSupported: false, waterCache: new Map(), riskPromise: null,
    autoWaterSuspended: false, lastBaseError: null
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (s) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[s]));
  }
  function render() { if (state.viewer) state.viewer.scene.requestRender(); }
  function setText(id, text) { const el = $(id); if (el) el.textContent = text; }
  function providerUrl(layer) {
    const p = layer && layer.imageryProvider;
    return String((p && (p.url || (p._resource && p._resource.url))) || '');
  }
  function isGsiBaseLayer(layer) { return /cyberjapandata\.gsi\.go\.jp\/xyz\/(seamlessphoto|pale|std)\//.test(providerUrl(layer)); }

  function injectStyle() {
    if ($('immersiveStyle')) return;
    const style = document.createElement('style');
    style.id = 'immersiveStyle';
    style.textContent = `
      #basemapStatus strong{color:#a9e7f0}.immersive-status{font-size:11.5px;line-height:1.5;color:#b9c9d6}
      #walkRisk{margin-top:8px;padding:8px 10px;border:1px solid #45677e;border-radius:7px;background:#112f43cc;color:#dbeef5;font-size:12px;line-height:1.5}
      #walkRisk.warning{border-color:#e2b84c;background:#4a3818e8;color:#fff0b2}#walkRisk strong{color:#fff}
      .immersive-card-extra{margin-top:12px;padding-top:4px;border-top:1px solid #496078}.immersive-card-extra .risk-item dd{font-variant-numeric:tabular-nums}
      @media(max-width:700px){#walkRisk{font-size:11px;padding:6px 8px}.immersive-card-extra{margin-top:8px}}
    `;
    document.head.appendChild(style);
  }

  function setBasemapStatus(spec, warn = false) {
    const el = $('basemapStatus');
    if (!el) return;
    el.innerHTML = `<strong>背景：${esc(spec.label)}</strong><br>${esc(spec.note)}${warn ? '<br><span class="warn">一部の背景タイルを取得できません。通信状況を確認してください。</span>' : ''}`;
  }

  function installBasemap(kind) {
    if (!state.viewer) return;
    const spec = BASEMAPS[kind] || BASEMAPS.seamlessphoto;
    const layers = state.viewer.imageryLayers;
    const oldLayers = new Set();
    if (state.baseLayer) oldLayers.add(state.baseLayer);
    if (layers.length && isGsiBaseLayer(layers.get(0))) oldLayers.add(layers.get(0));
    const provider = new C.UrlTemplateImageryProvider({
      url: spec.url,
      rectangle: GSI_RECTANGLE,
      minimumLevel: spec.minimumLevel,
      maximumLevel: spec.maximumLevel,
      credit: new C.Credit('<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院 地理院タイル</a>')
    });
    provider.errorEvent.addEventListener((error) => {
      state.lastBaseError = error && (error.message || error.statusCode || String(error));
      setBasemapStatus(spec, true);
      setTimeout(() => { if (state.baseKind === kind) setBasemapStatus(spec, false); }, 7000);
    });
    const layer = layers.addImageryProvider(provider, 0);
    layer.alpha = 1.0;
    layer.brightness = spec.brightness;
    layer.contrast = spec.contrast;
    layer.saturation = spec.saturation;
    layer.gamma = spec.gamma;
    layer.hue = 0.0;
    state.baseLayer = layer;
    state.baseKind = kind;
    setBasemapStatus(spec, false);
    setTimeout(() => {
      for (const old of oldLayers) {
        if (old && old !== layer && layers.contains(old)) layers.remove(old, true);
      }
      render();
    }, 420);
    render();
  }

  function findHazardLayer() {
    if (!state.viewer) return null;
    const layers = state.viewer.imageryLayers;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers.get(i);
      if (/disaportaldata\.gsi\.go\.jp/.test(providerUrl(layer))) return layer;
    }
    return layers.length > 1 ? layers.get(layers.length - 1) : null;
  }

  function setHazardOpacity(value) {
    const slider = $('hazardOpacity');
    if (!slider) return;
    slider.value = String(value);
    const out = $('hazardValue');
    if (out) out.textContent = `${value}%`;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function syncHazardPresentation(autoOpacity = false) {
    const hazard = $('hazard'), twoD = $('hazard2dEnabled'), water = $('water3dEnabled');
    if (!hazard) return;
    const layer = findHazardLayer();
    if (layer) layer.show = (!twoD || twoD.checked) && hazard.value !== 'none';
    if (autoOpacity) {
      const waterHazard = water && water.checked && (hazard.value === 'flood' || hazard.value === 'tsunami');
      setHazardOpacity(waterHazard ? 24 : 62);
    }
    render();
  }

  function syncWaterWithHazard() {
    const hazard = $('hazard'), water = $('water3dEnabled');
    if (!hazard || !water) return;
    const waterType = hazard.value === 'flood' || hazard.value === 'tsunami';
    if (!waterType && water.checked) {
      state.autoWaterSuspended = true;
      water.checked = false;
      water.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (waterType && state.autoWaterSuspended && !water.checked) {
      state.autoWaterSuspended = false;
      water.checked = true;
      water.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function featureText(feature) {
    try {
      const values = [];
      for (const key of feature.getPropertyIds()) {
        const v = feature.getProperty(key);
        if (v !== null && v !== undefined && v !== '') values.push(`${key}:${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
      return values.join(' ').toLowerCase();
    } catch (_) { return ''; }
  }
  function featureHeight(feature) {
    const keys = ['measuredHeight','height','建物高さ','bldg:measuredHeight','_height'];
    for (const key of keys) {
      try {
        if (feature.hasProperty(key)) {
          const n = Number(feature.getProperty(key));
          if (Number.isFinite(n) && n > 0) return n;
        }
      } catch (_) {}
    }
    return 0;
  }
  function scenicColor(feature, alpha) {
    const t = featureText(feature);
    let css = '#d7d2c8';
    if (/(住宅|共同住宅|residential|house|apartment)/.test(t)) css = '#ded3c3';
    else if (/(商業|店舗|事務所|office|shop|hotel|business)/.test(t)) css = '#d9dde1';
    else if (/(学校|庁舎|公共|病院|文化|行政|school|hospital|public)/.test(t)) css = '#c9d7dc';
    else if (/(工場|倉庫|industrial|factory|warehouse)/.test(t)) css = '#aeb5b8';
    let c = C.Color.fromCssColorString(css);
    const h = featureHeight(feature);
    const shade = h >= 40 ? 0.82 : h >= 20 ? 0.89 : h >= 10 ? 0.95 : 1.0;
    c = new C.Color(c.red * shade, c.green * shade, c.blue * shade, alpha);
    return c;
  }

  function applyScenicVisuals(tile) {
    const scenic = $('buildingScenic'), riskMode = $('riskMode'), opacity = $('buildingOpacity');
    if (!tile || !tile.content || !riskMode || riskMode.value !== 'normal') return;
    const alpha = opacity ? Number(opacity.value) / 100 : 0.88;
    const n = Number(tile.content.featuresLength || 0);
    for (let i = 0; i < n; i++) {
      const f = tile.content.getFeature(i);
      f.color = scenic && scenic.checked ? scenicColor(f, alpha) : C.Color.fromCssColorString('#dde9ef').withAlpha(alpha);
    }
  }

  function refreshTileset() {
    if (!state.tileset) return;
    const visible = state.tileset.show;
    state.tileset.show = false;
    render();
    requestAnimationFrame(() => {
      if (!state.tileset) return;
      state.tileset.show = visible;
      render();
    });
  }

  function attachTileset(tileset) {
    if (!tileset || tileset.__matsuyamaImmersiveAttached) return;
    tileset.__matsuyamaImmersiveAttached = true;
    state.tileset = tileset;
    state.tilesetAttached = true;
    state.drapeSupported = !!tileset.imageryLayers;
    tileset.tileVisible.addEventListener(applyScenicVisuals);
    const restSse = isMobile ? 18 : 12;
    const movingSse = isMobile ? 28 : 22;
    tileset.maximumScreenSpaceError = restSse;
    try { tileset.shadows = isMobile ? C.ShadowMode.DISABLED : C.ShadowMode.ENABLED; } catch (_) {}
    state.viewer.camera.moveStart.addEventListener(() => { if (state.tileset) state.tileset.maximumScreenSpaceError = movingSse; });
    state.viewer.camera.moveEnd.addEventListener(() => { if (state.tileset) { state.tileset.maximumScreenSpaceError = restSse; render(); } });
    const status = $('buildingScenicStatus');
    if (status) status.textContent = state.drapeSupported
      ? 'LOD1の用途・高さ等による簡易景観色です。Cesium 1.130の3D Tiles画像ドレープAPIは利用可能ですが、屋根面だけに限定できず壁面誤投影を避けるため航空写真は建物へ投影していません。'
      : 'LOD1の用途・高さ等による簡易景観色です。実際の窓・外壁・ファサードではありません。';
    refreshTileset();
  }

  function findAndAttachTileset() {
    if (!state.viewer || state.tilesetAttached) return;
    const p = state.viewer.scene.primitives;
    for (let i = 0; i < p.length; i++) {
      const candidate = p.get(i);
      if (candidate instanceof C.Cesium3DTileset) { attachTileset(candidate); return; }
    }
  }

  function tuneWaterPrimitives() {
    if (!state.viewer || !$('water3dEnabled') || !$('water3dEnabled').checked) return;
    const scenario = $('water3dScenario') ? $('water3dScenario').value : 'flood';
    const p = state.viewer.scene.primitives;
    let changed = false;
    for (let i = 0; i < p.length; i++) {
      const primitive = p.get(i);
      const material = primitive && primitive.appearance && primitive.appearance.material;
      const u = material && material.uniforms;
      if (!u || !('frequency' in u) || !('animationSpeed' in u) || !('amplitude' in u)) continue;
      const signature = `${scenario}:${scenario === 'tsunami' ? '2400/0.007/1.6/0.40' : '3200/0.006/1.2/0.35'}`;
      if (primitive.__matsuyamaWaterTune === signature) continue;
      u.frequency = scenario === 'tsunami' ? 2400.0 : 3200.0;
      u.animationSpeed = scenario === 'tsunami' ? 0.007 : 0.006;
      u.amplitude = scenario === 'tsunami' ? 1.6 : 1.2;
      if ('specularIntensity' in u) u.specularIntensity = scenario === 'tsunami' ? 0.40 : 0.35;
      primitive.__matsuyamaWaterTune = signature;
      changed = true;
    }
    if (changed) render();
  }

  function ringContains(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = Number(ring[i][0]), yi = Number(ring[i][1]), xj = Number(ring[j][0]), yj = Number(ring[j][1]);
      const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-30) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }
  function polygonContains(rings, x, y) {
    if (!rings || !rings.length || !ringContains(rings[0], x, y)) return false;
    for (let i = 1; i < rings.length; i++) if (ringContains(rings[i], x, y)) return false;
    return true;
  }
  function polygonBbox(rings) {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const ring of rings || []) for (const p of ring || []) {
      const x = Number(p[0]), y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y);
    }
    return [west, south, east, north];
  }
  function cellKey(lon, lat, size) { return `${Math.floor(lon / size)},${Math.floor(lat / size)}`; }

  async function loadWaterIndex(scenario) {
    if (state.waterCache.has(scenario)) return state.waterCache.get(scenario);
    const promise = (async () => {
      const r = await fetch(`analysis/water3d/${scenario}.json`, { cache: 'force-cache' });
      if (!r.ok) throw new Error(`water risk ${scenario} ${r.status}`);
      const raw = await r.json();
      const classes = new Map(Object.entries(raw.classes || {}).map(([k, v]) => [Number(k), { label:String(v[0] || ''), mid:Number(v[1]), upper:Number(v[2]), color:v[3] }]));
      const cellSize = 0.01, cells = new Map(), global = [];
      function add(cls, rings) {
        const bbox = polygonBbox(rings);
        if (!Number.isFinite(bbox[0])) return;
        const part = { cls:Number(cls), rings, bbox };
        const ix0 = Math.floor(bbox[0] / cellSize), ix1 = Math.floor(bbox[2] / cellSize), iy0 = Math.floor(bbox[1] / cellSize), iy1 = Math.floor(bbox[3] / cellSize);
        if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > 64) { global.push(part); return; }
        for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) {
          const key = `${ix},${iy}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(part);
        }
      }
      for (const f of raw.features || []) {
        const cls = Number(f[0]), type = Number(f[1]), coords = f[2];
        if (type === 0) add(cls, coords);
        else if (type === 1) for (const polygon of coords || []) add(cls, polygon);
      }
      return { scenario, classes, cellSize, cells, global };
    })();
    state.waterCache.set(scenario, promise);
    try { return await promise; } catch (e) { state.waterCache.delete(scenario); throw e; }
  }

  function hitWater(index, lon, lat) {
    const candidates = [...index.global, ...(index.cells.get(cellKey(lon, lat, index.cellSize)) || [])];
    let best = null;
    for (const p of candidates) {
      const b = p.bbox;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3] || !polygonContains(p.rings, lon, lat)) continue;
      const cls = index.classes.get(p.cls);
      if (!cls) continue;
      if (!best || Number(cls.mid || 0) > Number(best.info.mid || 0)) best = { cls:p.cls, info:cls };
    }
    return best;
  }

  function tuneWalkAvatar() {
    const walk = window.MatsuyamaWalk;
    if (!walk || !walk.state || !walk.state.avatar || !walk.state.avatar.billboard) return;
    const bb = walk.state.avatar.billboard;
    try {
      bb.sizeInMeters = true;
      bb.width = 0.55;
      bb.height = 1.75;
      bb.verticalOrigin = C.VerticalOrigin.CENTER;
      bb.disableDepthTestDistance = 0;
      bb.scaleByDistance = undefined;
    } catch (_) {}
  }

  async function updateWalkRisk() {
    const walk = window.MatsuyamaWalk;
    if (!walk || !walk.state) return;
    tuneWalkAvatar();
    const hud = $('walkHud');
    if (hud && !$('walkRisk')) {
      const risk = document.createElement('div');
      risk.id = 'walkRisk';
      risk.textContent = '現在地の浸水深区分を確認中…';
      hud.appendChild(risk);
    }
    const risk = $('walkRisk');
    if (!risk || !walk.state.active) return;
    const scenario = $('water3dScenario') ? $('water3dScenario').value : 'flood';
    const mode = $('water3dDepthMode') ? $('water3dDepthMode').value : 'mid';
    try {
      const index = await loadWaterIndex(scenario);
      if (!walk.state.active) return;
      const hit = hitWater(index, Number(walk.state.lon), Number(walk.state.lat));
      if (!hit) {
        risk.classList.remove('warning');
        risk.innerHTML = `<strong>現在地：</strong>${scenario === 'flood' ? '洪水' : '津波'}の表示用3Dデータでは浸水区域に該当しません。<br><small>無着色・非該当は安全を保証しません。</small>`;
        return;
      }
      const depth = Number(mode === 'upper' ? hit.info.upper : hit.info.mid);
      const eye = Number(walk.state.eye || 1.67);
      const diff = depth - eye;
      const relation = diff > 0.05 ? `表示水面が目線高を約 ${diff.toFixed(2)} m 上回ります` : Math.abs(diff) <= 0.15 ? '表示水面は目線付近です' : `表示水面は目線より約 ${Math.abs(diff).toFixed(2)} m 下です`;
      risk.classList.toggle('warning', diff > 0.05);
      risk.innerHTML = `<strong>現在地：</strong>${scenario === 'flood' ? '洪水浸水想定区域' : '津波浸水想定区域（旧公開ベクトル）'}<br>想定浸水深区分：${esc(hit.info.label || '区分あり')}<br>表示水深：${Number.isFinite(depth) ? depth.toFixed(2) : '—'} m（${mode === 'upper' ? '区分上限値' : '区分代表値'}）　人物目線高：${eye.toFixed(2)} m<br><strong>${esc(relation)}</strong><br><small>${scenario === 'tsunami' ? '公開取得可能な旧ベクトルであり、愛媛県2025年9月2日変更想定と一致しない可能性があります。' : '浸水深区分を可視化した推定表示で、実測値・時系列洪水シミュレーションではありません。'}</small>`;
    } catch (e) {
      risk.classList.remove('warning');
      risk.textContent = `現在地の浸水区分を取得できません：${e.message}`;
    }
  }

  async function loadRiskData() {
    if (state.riskPromise) return state.riskPromise;
    state.riskPromise = (async () => {
      const r = await fetch('analysis/building-risk.json', { cache: 'force-cache' });
      if (!r.ok) throw new Error(`building risk ${r.status}`);
      const raw = await r.json();
      const schema = Object.fromEntries((raw.schema || []).map((name, i) => [name, i]));
      const byId = new Map();
      for (const rec of raw.records || []) {
        for (const name of ['sourceId','key']) {
          const idx = schema[name], value = idx === undefined ? null : rec[idx];
          if (value !== null && value !== undefined && value !== '') byId.set(String(value), rec);
        }
      }
      return { raw, schema, byId };
    })();
    return state.riskPromise;
  }

  async function enhanceBuildingCard() {
    const card = $('feature'), props = $('properties'), title = $('featureTitle');
    if (!card || card.hidden || !props || !title || !title.textContent.includes('建物リスクカルテ')) return;
    let plateauId = '';
    for (const row of props.querySelectorAll('.risk-item')) {
      const dt = row.querySelector('dt'), dd = row.querySelector('dd');
      if (dt && dd && dt.textContent.trim() === 'PLATEAU ID') { plateauId = dd.textContent.trim(); break; }
    }
    if (!plateauId) return;
    try {
      const data = await loadRiskData();
      const rec = data.byId.get(plateauId);
      if (!rec) return;
      const v = (name) => data.schema[name] === undefined ? null : rec[data.schema[name]];
      const riskMode = $('riskMode') ? $('riskMode').value : 'normal';
      const scenario = riskMode === 'flood' || riskMode === 'tsunami' ? riskMode : ($('water3dScenario') ? $('water3dScenario').value : 'flood');
      const depthMode = $('water3dDepthMode') ? $('water3dDepthMode').value : 'mid';
      const rank = Number(scenario === 'flood' ? (v('floodRank') || 0) : (v('tsunamiSeverity') || 0));
      const index = await loadWaterIndex(scenario);
      let cls = index.classes.get(rank) || null;
      const label = String(scenario === 'flood' ? (v('floodLabel') || '') : (v('tsunamiLabel') || ''));
      if (!cls && label) cls = [...index.classes.values()].find((x) => x.label && (label.includes(x.label) || x.label.includes(label))) || null;
      const existing = props.querySelector('.immersive-card-extra');
      const signature = `${plateauId}|${scenario}|${depthMode}|${rank}|${cls ? cls.label : 'none'}`;
      if (existing && existing.dataset.signature === signature) return;
      if (existing) existing.remove();
      const extra = document.createElement('div');
      extra.className = 'immersive-card-extra';
      extra.dataset.signature = signature;
      const buildingHeight = Number(v('height'));
      const floors = v('floors');
      if (!rank || !cls) {
        extra.innerHTML = `<h3>浸水高さ｜区分に基づく参考表示</h3><div class="risk-item"><dt>${scenario === 'flood' ? '洪水' : '津波'}の表示対象</dt><dd>当該分析データでは浸水区分なし</dd></div><p class="card-note">非該当は安全を保証しません。建物・浸水データは基準時点と精度が異なります。</p>`;
      } else {
        const depth = Number(depthMode === 'upper' ? cls.upper : cls.mid);
        const ratio = Number.isFinite(buildingHeight) && buildingHeight > 0 && Number.isFinite(depth) ? Math.round(depth / buildingHeight * 100) : null;
        extra.innerHTML = `<h3>浸水高さ｜区分に基づく参考表示</h3><div class="risk-item"><dt>浸水深区分</dt><dd>${esc(cls.label || label || '区分あり')}</dd></div><div class="risk-item"><dt>表示用水深</dt><dd>${Number.isFinite(depth) ? depth.toFixed(2) + ' m' : '算定不可'} <small>（${depthMode === 'upper' ? '区分上限値・保守表示' : '区分代表値'}）</small></dd></div><div class="risk-item"><dt>建物高さに対する表示水深</dt><dd>${ratio === null ? '算定不可' : `約 ${ratio}%`}<small>建物高さ：${Number.isFinite(buildingHeight) && buildingHeight > 0 ? `約 ${buildingHeight} m` : '算定不可'}${floors ? `／地上階数収録値：${esc(floors)}` : ''}</small></dd></div><p class="card-note">建物高さと浸水深は異なるデータ精度を組み合わせた参考可視化です。実際の階高・被害・避難可否を示しません。${scenario === 'tsunami' ? '津波は公開取得可能な旧ベクトルで、県2025年変更想定と一致しない可能性があります。' : ''}</p>`;
      }
      props.appendChild(extra);
    } catch (_) {}
  }

  function monitorBuildingCard() {
    const props = $('properties');
    if (!props) return;
    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(enhanceBuildingCard, 80); };
    new MutationObserver(schedule).observe(props, { childList: true, subtree: true });
    for (const id of ['riskMode','water3dScenario','water3dDepthMode']) {
      const el = $(id); if (el) el.addEventListener('change', schedule);
    }
  }

  function applyDeviceTuning() {
    if (!state.viewer) return;
    state.viewer.resolutionScale = isMobile ? 0.82 : 1.0;
    state.viewer.scene.globe.maximumScreenSpaceError = isMobile ? 3.0 : 2.0;
    if ('verticalExaggeration' in state.viewer.scene) state.viewer.scene.verticalExaggeration = 1.0;
    window.addEventListener('orientationchange', () => setTimeout(() => { try { state.viewer.resize(); render(); } catch (_) {} }, 180));
  }

  function bindUi() {
    const basemap = $('basemap');
    if (basemap) basemap.addEventListener('change', () => setTimeout(() => installBasemap(basemap.value), 0));
    const scenic = $('buildingScenic'), opacity = $('buildingOpacity'), risk = $('riskMode');
    if (scenic) scenic.addEventListener('change', refreshTileset);
    if (opacity) opacity.addEventListener('input', refreshTileset);
    if (risk) risk.addEventListener('change', () => setTimeout(refreshTileset, 80));
    const twoD = $('hazard2dEnabled'), hazard = $('hazard'), water = $('water3dEnabled');
    if (twoD) twoD.addEventListener('change', () => syncHazardPresentation(false));
    if (water) water.addEventListener('change', () => setTimeout(() => syncHazardPresentation(true), 0));
    if (hazard) hazard.addEventListener('change', () => setTimeout(() => { syncWaterWithHazard(); syncHazardPresentation(true); }, 40));
    for (const id of ['water3dScenario','water3dDepthMode','water3dOpacity']) {
      const el = $(id); if (el) el.addEventListener(id === 'water3dOpacity' ? 'input' : 'change', () => setTimeout(tuneWaterPrimitives, 120));
    }
    const status = $('water3dStatus');
    if (status) new MutationObserver(() => {
      if (/表示できません/.test(status.textContent || '')) setHazardOpacity(62);
      else setTimeout(tuneWaterPrimitives, 80);
    }).observe(status, { childList: true, subtree: true, characterData: true });
  }

  function init(viewer) {
    state.viewer = viewer;
    injectStyle();
    applyDeviceTuning();
    bindUi();
    monitorBuildingCard();
    installBasemap($('basemap') ? $('basemap').value : 'seamlessphoto');
    syncHazardPresentation(false);
    setInterval(findAndAttachTileset, 350);
    setInterval(tuneWaterPrimitives, 1100);
    setInterval(updateWalkRisk, 650);
    setTimeout(findAndAttachTileset, 250);
    setTimeout(updateWalkRisk, 700);
    window.MatsuyamaImmersive = {
      refreshBuildings: refreshTileset,
      refreshHazard: () => syncHazardPresentation(false),
      updateWalkRisk,
      debug: () => {
        const hazardLayer = findHazardLayer();
        const p = state.baseLayer && state.baseLayer.imageryProvider;
        return {
          base: state.baseKind,
          baseUrl: p ? String(p.url || (p._resource && p._resource.url) || '') : '',
          baseMinimumLevel: p ? p.minimumLevel : null,
          baseMaximumLevel: p ? p.maximumLevel : null,
          baseBrightness: state.baseLayer ? state.baseLayer.brightness : null,
          baseContrast: state.baseLayer ? state.baseLayer.contrast : null,
          baseSaturation: state.baseLayer ? state.baseLayer.saturation : null,
          baseGamma: state.baseLayer ? state.baseLayer.gamma : null,
          mobile: isMobile,
          tilesetAttached: state.tilesetAttached,
          drapeSupported: state.drapeSupported,
          tilesetSSE: state.tileset ? state.tileset.maximumScreenSpaceError : null,
          hazard2dVisible: hazardLayer ? hazardLayer.show : null,
          hazardAlpha: hazardLayer ? hazardLayer.alpha : null,
          resolutionScale: state.viewer.resolutionScale,
          verticalExaggeration: 'verticalExaggeration' in state.viewer.scene ? state.viewer.scene.verticalExaggeration : 1.0
        };
      }
    };
  }

  function waitForViewer() {
    const viewer = window.__matsuyamaViewer;
    if (viewer && !viewer.isDestroyed()) { init(viewer); return; }
    setTimeout(waitForViewer, 80);
  }
  waitForViewer();
})();
