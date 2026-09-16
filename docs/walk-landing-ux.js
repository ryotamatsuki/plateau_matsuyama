'use strict';

(function installWalkLandingUx() {
  if (window.__matsuyamaWalkLandingUxInstalled) return;
  window.__matsuyamaWalkLandingUxInstalled = true;

  const state = {
    initialized: false,
    selecting: false,
    candidate: null,
    marker: null,
    pointerDown: null,
    minimapZoom: 16,
    minimapRaf: 0,
    minimapLast: 0,
    minimapTileKey: '',
    lastConfirmedCandidate: null
  };

  let C = null;
  let viewer = null;
  let walk = null;
  let nav = null;
  let navButton = null;
  let selector = null;
  let selectorCoords = null;
  let minimap = null;
  let minimapViewport = null;
  let minimapTiles = null;
  let minimapArrow = null;
  let minimapViewCone = null;
  let minimapCoords = null;
  let originalButtonHandler = null;

  function plausibleTerrainHeight(h) {
    return Number.isFinite(h) && h > -500 && h < 3000;
  }

  function injectStyle() {
    if (document.getElementById('walkLandingUxStyle')) return;
    const style = document.createElement('style');
    style.id = 'walkLandingUxStyle';
    style.textContent = `
      #landingSelector[hidden],#walkMinimap[hidden]{display:none!important}
      #landingSelector{position:absolute;inset:0;z-index:16;pointer-events:none}
      .landing-selector-card{position:absolute;left:50%;top:max(16px,env(safe-area-inset-top));transform:translateX(-50%);width:min(520px,calc(100% - 30px));padding:10px 12px;border:1px solid #74d8e8;border-radius:12px;background:#0c2639ee;color:#f4fbff;box-shadow:0 12px 32px #0008;font:13px/1.45 system-ui;backdrop-filter:blur(6px);pointer-events:auto}
      .landing-selector-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.landing-selector-title{font-weight:800}.landing-selector-hint{margin-top:4px;color:#c7dbe5;font-size:11.5px}.landing-selector-coords{margin-top:5px;color:#9ee8f4;font-variant-numeric:tabular-nums;font-size:11px}
      .landing-selector-card button{min-height:36px;padding:6px 10px;border:1px solid #7fa8bb;border-radius:8px;background:#153b54;color:#fff;font:700 12px system-ui;cursor:pointer;touch-action:manipulation}
      #landingReticle{position:absolute;left:50%;top:50%;width:34px;height:46px;transform:translate(-50%,-100%);filter:drop-shadow(0 3px 4px #0009);pointer-events:none}
      #landingReticle:before{content:"";position:absolute;left:8px;top:3px;width:18px;height:18px;border:4px solid #63e3f2;border-radius:50%;background:#0f3b52cc;box-shadow:0 0 0 2px #fff}
      #landingReticle:after{content:"";position:absolute;left:15px;top:24px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:16px solid #63e3f2}
      body.landing-select-active #map{cursor:crosshair}
      #walkMinimap{position:absolute;right:16px;bottom:16px;z-index:14;width:178px;padding:7px;border:1px solid #6d8da2;border-radius:12px;background:#0b2031e8;color:#ecf8fc;box-shadow:0 10px 28px #0008;font:11px/1.3 system-ui;backdrop-filter:blur(5px);pointer-events:auto}
      .walk-minimap-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px}.walk-minimap-head strong{font-size:12px}.walk-minimap-controls{display:flex;gap:4px}.walk-minimap-controls button{width:26px;height:26px;border:1px solid #7896a8;border-radius:7px;background:#14354b;color:#fff;font:800 15px/1 system-ui;cursor:pointer;touch-action:manipulation}
      #walkMinimapViewport{position:relative;width:164px;height:164px;overflow:hidden;border:1px solid #66869b;border-radius:8px;background:#d7e5ec;isolation:isolate}
      #walkMinimapTiles{position:absolute;inset:0}.walk-minimap-tile{position:absolute;width:256px;height:256px;max-width:none;user-select:none;-webkit-user-drag:none;pointer-events:none}
      #walkMinimapViewCone{position:absolute;left:50%;top:50%;width:0;height:0;border-left:24px solid transparent;border-right:24px solid transparent;border-bottom:58px solid #3ecfe92f;transform-origin:50% 100%;pointer-events:none;filter:drop-shadow(0 0 1px #0c3346)}
      #walkMinimapArrow{position:absolute;left:50%;top:50%;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:20px solid #00c8ea;transform-origin:50% 65%;filter:drop-shadow(0 0 2px #fff) drop-shadow(0 2px 2px #000b);pointer-events:none}
      #walkMinimapArrow:after{content:"";position:absolute;left:-4px;top:11px;width:8px;height:8px;border-radius:50%;background:#fff;border:2px solid #0b7e9b}
      .walk-minimap-coords{margin-top:5px;font-size:9.5px;color:#c7dae4;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.walk-minimap-credit{margin-top:2px;text-align:right;font-size:8.5px}.walk-minimap-credit a{color:#9fdce9}
      @media(max-width:700px),(pointer:coarse){
        .landing-selector-card{top:max(58px,calc(env(safe-area-inset-top) + 52px));width:min(94vw,520px);padding:8px 10px;font-size:12px}.landing-selector-hint{font-size:10.5px}.landing-selector-coords{font-size:10px}
        #landingReticle{top:48%}
        #walkMinimap{left:50%;right:auto;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);width:142px;padding:5px;z-index:14}
        #walkMinimapViewport{width:130px;height:130px}.walk-minimap-head{margin-bottom:3px}.walk-minimap-head strong{font-size:10.5px}.walk-minimap-controls button{width:24px;height:24px;font-size:14px}.walk-minimap-coords{font-size:8.5px}.walk-minimap-credit{display:none}
      }
    `;
    document.head.appendChild(style);
  }

  function installSelector() {
    if (document.getElementById('landingSelector')) {
      selector = document.getElementById('landingSelector');
      selectorCoords = document.getElementById('landingSelectorCoords');
      return;
    }
    const main = document.querySelector('main');
    if (!main) return;
    selector = document.createElement('div');
    selector.id = 'landingSelector';
    selector.hidden = true;
    selector.innerHTML = `
      <div class="landing-selector-card" role="status" aria-live="polite">
        <div class="landing-selector-head"><span class="landing-selector-title">📍 防災ウォークの着地点を選択</span><button id="landingSelectorCancel" type="button">キャンセル</button></div>
        <div class="landing-selector-hint">地図をドラッグ・ズームして位置を合わせるか、地面をクリック／タップして選択してください。中央のピン位置が着地点です。</div>
        <div class="landing-selector-coords" id="landingSelectorCoords">着地点を取得中…</div>
      </div>
      <div id="landingReticle" aria-hidden="true"></div>`;
    main.appendChild(selector);
    selectorCoords = selector.querySelector('#landingSelectorCoords');
    selector.querySelector('#landingSelectorCancel').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelLandingSelection();
    });
  }

  function installMinimap() {
    if (document.getElementById('walkMinimap')) {
      minimap = document.getElementById('walkMinimap');
      minimapViewport = document.getElementById('walkMinimapViewport');
      minimapTiles = document.getElementById('walkMinimapTiles');
      minimapArrow = document.getElementById('walkMinimapArrow');
      minimapViewCone = document.getElementById('walkMinimapViewCone');
      minimapCoords = document.getElementById('walkMinimapCoords');
      return;
    }
    const main = document.querySelector('main');
    if (!main) return;
    minimap = document.createElement('div');
    minimap.id = 'walkMinimap';
    minimap.hidden = true;
    minimap.setAttribute('aria-label', '防災ウォークの現在地ミニマップ');
    minimap.innerHTML = `
      <div class="walk-minimap-head"><strong>現在地</strong><div class="walk-minimap-controls"><button id="walkMinimapOut" type="button" aria-label="ミニマップを縮小">−</button><button id="walkMinimapIn" type="button" aria-label="ミニマップを拡大">＋</button></div></div>
      <div id="walkMinimapViewport"><div id="walkMinimapTiles"></div><div id="walkMinimapViewCone"></div><div id="walkMinimapArrow"></div></div>
      <div class="walk-minimap-coords" id="walkMinimapCoords"></div>
      <div class="walk-minimap-credit"><a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院地図</a></div>`;
    main.appendChild(minimap);
    minimapViewport = minimap.querySelector('#walkMinimapViewport');
    minimapTiles = minimap.querySelector('#walkMinimapTiles');
    minimapArrow = minimap.querySelector('#walkMinimapArrow');
    minimapViewCone = minimap.querySelector('#walkMinimapViewCone');
    minimapCoords = minimap.querySelector('#walkMinimapCoords');
    const changeZoom = (delta) => {
      state.minimapZoom = Math.max(14, Math.min(18, state.minimapZoom + delta));
      state.minimapTileKey = '';
      updateMinimap(true);
    };
    minimap.querySelector('#walkMinimapOut').addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); changeZoom(-1); });
    minimap.querySelector('#walkMinimapIn').addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); changeZoom(1); });
    for (const type of ['pointerdown','pointerup','pointermove','click','touchstart','touchmove','touchend']) {
      minimap.addEventListener(type, (event) => event.stopPropagation(), { passive: type === 'touchmove' ? false : true });
    }
  }

  function canvasPointFromClient(clientX, clientY) {
    const rect = viewer.canvas.getBoundingClientRect();
    return new C.Cartesian2(clientX - rect.left, clientY - rect.top);
  }

  function terrainPointAtWindowPosition(position) {
    try {
      const ray = viewer.camera.getPickRay(position);
      const point = ray && viewer.scene.globe.pick(ray, viewer.scene);
      if (point) return point;
    } catch (_) {}
    try {
      return viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid) || null;
    } catch (_) { return null; }
  }

  async function targetAtWindowPosition(position) {
    const point = terrainPointAtWindowPosition(position);
    if (!point) return null;
    const cart = C.Cartographic.fromCartesian(point);
    const lon = C.Math.toDegrees(cart.longitude);
    const lat = C.Math.toDegrees(cart.latitude);
    if (!(lon >= 132.45 && lon <= 132.97 && lat >= 33.65 && lat <= 34.13)) return null;
    let ground = null;
    const sampler = window.MatsuyamaTerrain && window.MatsuyamaTerrain.sampleEllipsoidHeight;
    if (typeof sampler === 'function') {
      try {
        const h = await sampler(lon, lat);
        if (plausibleTerrainHeight(h)) ground = h;
      } catch (_) {}
    }
    if (ground === null) {
      try {
        const h = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
        if (plausibleTerrainHeight(h)) ground = h;
      } catch (_) {}
    }
    if (ground === null && plausibleTerrainHeight(cart.height)) ground = cart.height;
    if (ground === null) ground = 0;
    return { lon, lat, ground };
  }

  function setLandingMarker(target) {
    if (!target) return;
    const position = C.Cartesian3.fromDegrees(target.lon, target.lat, target.ground + 0.45);
    if (!state.marker) {
      state.marker = viewer.entities.add({
        position,
        point: { pixelSize: 16, color: C.Color.fromCssColorString('#4de4f4'), outlineColor: C.Color.WHITE, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: '着地点', font: '700 13px sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.fromCssColorString('#08364a'), outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -28), disableDepthTestDistance: Number.POSITIVE_INFINITY }
      });
    } else {
      state.marker.position = position;
      state.marker.show = true;
    }
    viewer.scene.requestRender();
  }

  function removeLandingMarker() {
    if (state.marker && viewer && !viewer.isDestroyed?.()) viewer.entities.remove(state.marker);
    state.marker = null;
  }

  function updateSelectorText(target) {
    if (!selectorCoords) return;
    if (!target) {
      selectorCoords.textContent = '着地点を取得できません。市域内の地面が中央に見えるよう調整してください。';
      return;
    }
    selectorCoords.textContent = `緯度 ${target.lat.toFixed(6)} / 経度 ${target.lon.toFixed(6)} / 地盤高 約 ${target.ground.toFixed(1)} m`;
  }

  function setCandidate(target) {
    state.candidate = target ? { ...target } : null;
    updateSelectorText(state.candidate);
    if (state.candidate) setLandingMarker(state.candidate);
    syncNavButton();
  }

  async function refreshCandidateFromCenter() {
    if (!state.selecting || !viewer) return null;
    const center = new C.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2);
    const target = await targetAtWindowPosition(center);
    if (!state.selecting) return null;
    setCandidate(target);
    return target;
  }

  function recenterOnTarget(target) {
    if (!target) return Promise.resolve(false);
    const center = C.Cartesian3.fromDegrees(target.lon, target.lat, target.ground);
    const range = Math.max(120, Math.min(6000, C.Cartesian3.distance(viewer.camera.positionWC, center)));
    const heading = Number.isFinite(viewer.camera.heading) ? viewer.camera.heading : 0;
    const pitch = C.Math.clamp(Number.isFinite(viewer.camera.pitch) ? viewer.camera.pitch : C.Math.toRadians(-55), C.Math.toRadians(-82), C.Math.toRadians(-28));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise((resolve) => {
      viewer.camera.flyToBoundingSphere(new C.BoundingSphere(center, 1), {
        offset: new C.HeadingPitchRange(heading, pitch, range),
        duration: reduced ? 0.05 : 0.28,
        easingFunction: C.EasingFunction.CUBIC_IN_OUT,
        complete: () => resolve(true),
        cancel: () => resolve(false)
      });
    });
  }

  async function beginLandingSelection() {
    if (!viewer || !nav || !walk || state.selecting) return false;
    const debug = nav.debug();
    if (debug.mode !== 'OVERVIEW' || debug.walkActive) return false;
    state.selecting = true;
    state.candidate = null;
    selector.hidden = false;
    document.body.classList.add('landing-select-active');
    viewer.scene.screenSpaceCameraController.enableInputs = true;
    syncNavButton();
    await refreshCandidateFromCenter();
    return true;
  }

  function cancelLandingSelection() {
    if (!state.selecting) return false;
    state.selecting = false;
    state.candidate = null;
    selector.hidden = true;
    document.body.classList.remove('landing-select-active');
    removeLandingMarker();
    syncNavButton();
    return true;
  }

  async function confirmLandingSelection() {
    if (!state.selecting || !nav) return false;
    let target = state.candidate || await refreshCandidateFromCenter();
    if (!target) return false;
    await recenterOnTarget(target);
    target = await refreshCandidateFromCenter() || target;
    state.lastConfirmedCandidate = { ...target };
    state.selecting = false;
    selector.hidden = true;
    document.body.classList.remove('landing-select-active');
    syncNavButton();
    const ok = await nav.toGround();
    removeLandingMarker();
    return ok;
  }

  function syncNavButton() {
    if (!navButton || !nav) return;
    const debug = nav.debug();
    if (debug.mode === 'TRANSITION_TO_OVERVIEW' || debug.mode === 'TRANSITION_TO_GROUND') return;
    if (state.selecting) {
      navButton.textContent = '◎ ここに降りる';
      navButton.setAttribute('aria-label', '中央のピン位置に降りて防災ウォークを開始します');
      navButton.disabled = !state.candidate;
      return;
    }
    if (debug.mode === 'OVERVIEW' && !debug.walkActive) {
      navButton.textContent = '📍 着地点を選ぶ';
      navButton.setAttribute('aria-label', '防災ウォークの着地点を地図上で選びます。Fキーでも開始できます');
      navButton.disabled = false;
    }
  }

  async function handleNavToggle() {
    if (!nav || !walk) return false;
    const debug = nav.debug();
    if (debug.mode === 'TRANSITION_TO_OVERVIEW' || debug.mode === 'TRANSITION_TO_GROUND') return false;
    if (walk.state.active || debug.mode === 'GROUND') {
      if (state.selecting) cancelLandingSelection();
      return nav.toOverview();
    }
    if (state.selecting) return confirmLandingSelection();
    return beginLandingSelection();
  }

  function installLandingInteraction() {
    originalButtonHandler = navButton.onclick;
    navButton.onclick = (event) => {
      event?.preventDefault?.();
      handleNavToggle();
    };

    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyF' && !event.repeat && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        handleNavToggle();
      } else if (event.code === 'Escape' && state.selecting) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelLandingSelection();
      }
    }, true);

    viewer.canvas.addEventListener('pointerdown', (event) => {
      if (!state.selecting) return;
      state.pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }, true);

    viewer.canvas.addEventListener('click', async (event) => {
      if (!state.selecting) return;
      const down = state.pointerDown;
      state.pointerDown = null;
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 10) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = await targetAtWindowPosition(canvasPointFromClient(event.clientX, event.clientY));
      if (!target || !state.selecting) return;
      setCandidate(target);
      await recenterOnTarget(target);
      if (state.selecting) await refreshCandidateFromCenter();
    }, true);

    viewer.camera.moveEnd.addEventListener(() => {
      if (state.selecting) refreshCandidateFromCenter();
    });

    window.addEventListener('matsuyama-navigation-state', () => {
      if (state.selecting && nav.debug().mode !== 'OVERVIEW') cancelLandingSelection();
      setTimeout(syncNavButton, 0);
    });
  }

  function worldPixel(lon, lat, zoom) {
    const n = 2 ** zoom;
    const x = (lon + 180) / 360 * n * 256;
    const rad = C.Math.toRadians(Math.max(-85.05112878, Math.min(85.05112878, lat)));
    const y = (1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n * 256;
    return { x, y, n };
  }

  function rebuildMinimapTiles(centerTileX, centerTileY) {
    if (!minimapTiles) return;
    minimapTiles.replaceChildren();
    const n = 2 ** state.minimapZoom;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const rawX = centerTileX + dx;
        const rawY = centerTileY + dy;
        if (rawY < 0 || rawY >= n) continue;
        const sourceX = ((rawX % n) + n) % n;
        const img = document.createElement('img');
        img.className = 'walk-minimap-tile';
        img.alt = '';
        img.draggable = false;
        img.dataset.tileX = String(rawX);
        img.dataset.tileY = String(rawY);
        img.src = `https://cyberjapandata.gsi.go.jp/xyz/std/${state.minimapZoom}/${sourceX}/${rawY}.png`;
        minimapTiles.appendChild(img);
      }
    }
  }

  function updateMinimap(force = false) {
    if (!minimap || !minimapViewport || !walk) return;
    if (!walk.state.active) {
      minimap.hidden = true;
      return;
    }
    minimap.hidden = false;
    const lon = Number(walk.state.lon);
    const lat = Number(walk.state.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const world = worldPixel(lon, lat, state.minimapZoom);
    const centerTileX = Math.floor(world.x / 256);
    const centerTileY = Math.floor(world.y / 256);
    const key = `${state.minimapZoom}/${centerTileX}/${centerTileY}`;
    if (force || key !== state.minimapTileKey) {
      state.minimapTileKey = key;
      rebuildMinimapTiles(centerTileX, centerTileY);
    }
    const width = minimapViewport.clientWidth || 164;
    const height = minimapViewport.clientHeight || 164;
    for (const img of minimapTiles.querySelectorAll('.walk-minimap-tile')) {
      const tx = Number(img.dataset.tileX);
      const ty = Number(img.dataset.tileY);
      img.style.left = `${tx * 256 - world.x + width / 2}px`;
      img.style.top = `${ty * 256 - world.y + height / 2}px`;
    }
    const headingDeg = C.Math.toDegrees(Number(walk.state.heading) || 0);
    const cameraHeadingDeg = C.Math.toDegrees(Number(walk.state.cameraHeading) || Number(walk.state.heading) || 0);
    minimapArrow.style.transform = `translate(-50%,-65%) rotate(${headingDeg.toFixed(2)}deg)`;
    minimapViewCone.style.transform = `translate(-50%,-100%) rotate(${cameraHeadingDeg.toFixed(2)}deg)`;
    minimapCoords.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)} ｜ z${state.minimapZoom}`;
  }

  function startMinimapLoop() {
    if (state.minimapRaf) return;
    state.minimapLast = 0;
    const tick = (now) => {
      if (!walk?.state?.active) {
        state.minimapRaf = 0;
        if (minimap) minimap.hidden = true;
        return;
      }
      if (!state.minimapLast || now - state.minimapLast >= 90) {
        state.minimapLast = now;
        updateMinimap(false);
      }
      state.minimapRaf = requestAnimationFrame(tick);
    };
    updateMinimap(true);
    state.minimapRaf = requestAnimationFrame(tick);
  }

  function installMinimapInteraction() {
    window.addEventListener('matsuyama-walk-active', (event) => {
      if (event.detail) startMinimapLoop();
      else {
        if (minimap) minimap.hidden = true;
        state.minimapTileKey = '';
      }
    });
    if (walk.state.active) startMinimapLoop();
  }

  function debug() {
    return {
      selecting: state.selecting,
      candidate: state.candidate ? { ...state.candidate } : null,
      lastConfirmedCandidate: state.lastConfirmedCandidate ? { ...state.lastConfirmedCandidate } : null,
      minimapVisible: !!(minimap && !minimap.hidden),
      minimapZoom: state.minimapZoom,
      minimapTileCount: minimapTiles ? minimapTiles.querySelectorAll('.walk-minimap-tile').length : 0,
      originalButtonHandlerPresent: typeof originalButtonHandler === 'function'
    };
  }

  function initialize() {
    C = window.Cesium;
    viewer = window.__matsuyamaViewer || window.MatsuyamaApp?.viewer;
    walk = window.MatsuyamaWalk;
    nav = window.MatsuyamaNavigation;
    navButton = document.getElementById('navFlightToggle');
    if (!C || !viewer || viewer.isDestroyed?.() || !walk || !nav || !navButton) {
      setTimeout(initialize, 70);
      return;
    }
    if (state.initialized) return;
    state.initialized = true;
    injectStyle();
    installSelector();
    installMinimap();
    installLandingInteraction();
    installMinimapInteraction();
    syncNavButton();
    window.MatsuyamaWalkUx = { beginLandingSelection, confirmLandingSelection, cancelLandingSelection, updateMinimap, debug };
    window.dispatchEvent(new CustomEvent('matsuyama-walk-ux-ready'));
  }

  initialize();
})();
