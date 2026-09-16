'use strict';

(function installMatsuyamaNavigation() {
  if (window.__matsuyamaNavigationInstalled) return;
  window.__matsuyamaNavigationInstalled = true;
  const C = window.Cesium;
  if (!C) return;

  const MODES = Object.freeze({
    GROUND: 'GROUND',
    TO_OVERVIEW: 'TRANSITION_TO_OVERVIEW',
    OVERVIEW: 'OVERVIEW',
    TO_GROUND: 'TRANSITION_TO_GROUND'
  });
  const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    mode: MODES.OVERVIEW,
    owner: 'CESIUM',
    reducedMotion: reducedMotionQuery.matches,
    lastFocus: { lon: 132.7657, lat: 33.8392, ground: 0 },
    transitionStartedAt: 0,
    lastTransitionMs: 0,
    lastLanding: null,
    rafId: 0,
    rafLast: 0,
    initialized: false
  };
  let viewer = null;
  let walk = null;
  let button = null;
  let externalHandlersWrapped = false;

  reducedMotionQuery.addEventListener?.('change', (event) => { state.reducedMotion = event.matches; });

  function emit() {
    updateButton();
    window.dispatchEvent(new CustomEvent('matsuyama-navigation-state', { detail: debug() }));
  }

  function setMode(mode, owner) {
    state.mode = mode;
    state.owner = owner;
    emit();
  }

  function isTransition() {
    return state.mode === MODES.TO_OVERVIEW || state.mode === MODES.TO_GROUND;
  }

  function updateButton() {
    if (!button) return;
    const groundLike = state.mode === MODES.GROUND || state.mode === MODES.TO_OVERVIEW;
    button.textContent = isTransition() ? '移動中…' : (groundLike ? '↑ 俯瞰へ飛ぶ' : '↓ 地上へ降りる');
    button.disabled = isTransition();
    button.setAttribute('aria-label', groundLike ? '俯瞰へ飛ぶ。Fキーでも切り替えできます' : '画面中央の地上へ降りる。Fキーでも切り替えできます');
    button.dataset.mode = state.mode;
  }

  function installButton() {
    if (document.getElementById('navFlightToggle')) {
      button = document.getElementById('navFlightToggle');
      return;
    }
    const main = document.querySelector('main');
    if (!main) return;
    const style = document.createElement('style');
    style.id = 'navigationControllerStyle';
    style.textContent = `
      #navFlightToggle{position:absolute;left:535px;top:18px;z-index:14;min-height:44px;padding:9px 14px;border:1px solid #76d9ec;border-radius:9px;background:#123950ef;color:#f4fbff;font:700 13px system-ui;box-shadow:0 8px 24px #0006;cursor:pointer;touch-action:manipulation}
      #navFlightToggle:hover{background:#1f6683}#navFlightToggle:disabled{opacity:.78;cursor:wait}
      @media(max-width:900px){#navFlightToggle{left:auto;right:18px;top:18px}}
      @media(max-width:700px),(pointer:coarse){#navFlightToggle{left:max(10px,env(safe-area-inset-left));right:auto;top:max(10px,env(safe-area-inset-top));min-height:42px;padding:8px 11px;font-size:12px;max-width:136px;z-index:15}body.walk-mode-active #navFlightToggle{display:block!important}}
      @media(prefers-reduced-motion:reduce){#navFlightToggle{transition:none}}
    `;
    document.head.appendChild(style);
    button = document.createElement('button');
    button.id = 'navFlightToggle';
    button.type = 'button';
    button.onclick = () => toggleMode();
    main.appendChild(button);
    updateButton();
  }

  function terrainHeight(lon, lat) {
    try {
      const h = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
      return Number.isFinite(h) ? h : null;
    } catch (_) { return null; }
  }

  async function resolveTerrainHeight(lon, lat, fallback = 0) {
    const immediate = terrainHeight(lon, lat);
    const base = immediate === null ? fallback : immediate;
    try {
      const result = await C.sampleTerrainMostDetailed(viewer.terrainProvider, [C.Cartographic.fromDegrees(lon, lat)]);
      return result[0] && Number.isFinite(result[0].height) ? result[0].height : base;
    } catch (_) { return base; }
  }

  function offsetLonLat(lon, lat, east, north) {
    const R = 6378137;
    const latRad = C.Math.toRadians(lat);
    return {
      lon: lon + C.Math.toDegrees(east / (R * Math.max(.15, Math.cos(latRad)))),
      lat: lat + C.Math.toDegrees(north / R)
    };
  }

  function headingBasis(lon, lat, ground, heading, offset = 0) {
    const origin = C.Cartesian3.fromDegrees(lon, lat, ground + offset);
    const m = C.Transforms.eastNorthUpToFixedFrame(origin);
    const col = (i) => {
      const v = C.Matrix4.getColumn(m, i, new C.Cartesian4());
      return new C.Cartesian3(v.x, v.y, v.z);
    };
    const east = col(0), north = col(1), up = col(2);
    const s = Math.sin(heading), c = Math.cos(heading);
    const forward = C.Cartesian3.normalize(C.Cartesian3.add(
      C.Cartesian3.multiplyByScalar(north, c, new C.Cartesian3()),
      C.Cartesian3.multiplyByScalar(east, s, new C.Cartesian3()),
      new C.Cartesian3()
    ), new C.Cartesian3());
    return { origin, east, north, up, forward };
  }

  function finalGroundCamera(lon, lat, ground, heading) {
    const pitch = walk?.state?.cameraPitch || C.Math.toRadians(24);
    const distance = walk?.state?.cameraDistance || 8.6;
    const basis = headingBasis(lon, lat, ground, heading, 1.25);
    const horizontal = Math.cos(pitch) * distance;
    const vertical = Math.sin(pitch) * distance;
    let destination = C.Cartesian3.subtract(basis.origin, C.Cartesian3.multiplyByScalar(basis.forward, horizontal, new C.Cartesian3()), new C.Cartesian3());
    destination = C.Cartesian3.add(destination, C.Cartesian3.multiplyByScalar(basis.up, vertical, new C.Cartesian3()), destination);
    return { destination, pitch: -pitch };
  }

  function fly(options) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (status) => {
        if (settled) return;
        settled = true;
        state.lastTransitionMs = performance.now() - state.transitionStartedAt;
        resolve(status);
      };
      viewer.camera.flyTo({ ...options, complete: () => done('complete'), cancel: () => done('cancel') });
    });
  }

  function prepareTransition(mode) {
    setMode(mode, 'NAVIGATION');
    state.transitionStartedAt = performance.now();
    viewer.camera.cancelFlight?.();
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    window.dispatchEvent(new CustomEvent('matsuyama-navigation-motion', { detail: { moving: true, mode } }));
  }

  function finishMotion() {
    window.dispatchEvent(new CustomEvent('matsuyama-navigation-motion', { detail: { moving: false, mode: state.mode } }));
    viewer.scene.requestRender();
  }

  function activeWalkPose() {
    if (!walk) return null;
    const s = walk.state;
    return {
      lon: s.lon, lat: s.lat, ground: s.ground,
      heading: s.view === 'third' ? s.cameraHeading : s.heading
    };
  }

  async function toOverview() {
    if (!viewer || !walk || isTransition()) return false;
    const pose = activeWalkPose();
    if (!pose || !walk.state.active) {
      setMode(MODES.OVERVIEW, 'CESIUM');
      viewer.scene.screenSpaceCameraController.enableInputs = true;
      return true;
    }
    state.lastFocus = { lon: pose.lon, lat: pose.lat, ground: pose.ground };
    prepareTransition(MODES.TO_OVERVIEW);
    walk.stop();
    const retreat = offsetLonLat(pose.lon, pose.lat, -Math.sin(pose.heading) * 120, -Math.cos(pose.heading) * 120);
    const duration = state.reducedMotion ? 0.12 : 1.05;
    const destination = C.Cartesian3.fromDegrees(retreat.lon, retreat.lat, pose.ground + 520);
    const status = await fly({
      destination,
      orientation: { heading: pose.heading, pitch: C.Math.toRadians(-67), roll: 0 },
      duration,
      easingFunction: C.EasingFunction.CUBIC_IN_OUT
    });
    viewer.scene.screenSpaceCameraController.enableInputs = true;
    setMode(MODES.OVERVIEW, 'CESIUM');
    finishMotion();
    return status === 'complete';
  }

  function centerTerrainPoint() {
    const center = new C.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2);
    try {
      const ray = viewer.camera.getPickRay(center);
      const p = ray && viewer.scene.globe.pick(ray, viewer.scene);
      if (p) return p;
    } catch (_) {}
    try {
      const p = viewer.camera.pickEllipsoid(center, viewer.scene.globe.ellipsoid);
      if (p) return p;
    } catch (_) {}
    return C.Cartesian3.fromDegrees(state.lastFocus.lon, state.lastFocus.lat, state.lastFocus.ground || 0);
  }

  async function landingTarget() {
    const point = centerTerrainPoint();
    const cart = C.Cartographic.fromCartesian(point);
    const lon = C.Math.toDegrees(cart.longitude), lat = C.Math.toDegrees(cart.latitude);
    const fallback = terrainHeight(lon, lat) ?? cart.height ?? state.lastFocus.ground ?? 0;
    const ground = await resolveTerrainHeight(lon, lat, fallback);
    return { lon, lat, ground };
  }

  function resumeWalkAtLanding(target, heading) {
    const pose = {
      lon: target.lon, lat: target.lat, ground: target.ground,
      heading, cameraHeading: heading
    };
    Object.assign(walk.state, pose);
    walk.start();
    // walk.start() samples the currently-rendered globe height synchronously before
    // its detailed terrain refinement completes. On a freshly deployed Pages load,
    // that rendered LOD can differ materially from sampleTerrainMostDetailed().
    // The landing target above is the authoritative detailed terrain height, so
    // restore it after start() and immediately rebuild the walk camera from it.
    Object.assign(walk.state, pose);
    walk.setView('third');
  }

  async function toGround() {
    if (!viewer || !walk || isTransition()) return false;
    if (walk.state.active) {
      setMode(MODES.GROUND, 'WALK');
      return true;
    }
    const target = await landingTarget();
    const heading = Number.isFinite(viewer.camera.heading) ? C.Math.zeroToTwoPi(viewer.camera.heading) : (walk.state.heading || 0);
    state.lastFocus = target;
    state.lastLanding = { ...target, heading };
    prepareTransition(MODES.TO_GROUND);
    const camera = finalGroundCamera(target.lon, target.lat, target.ground, heading);
    const duration = state.reducedMotion ? 0.12 : 0.95;
    const status = await fly({
      destination: camera.destination,
      orientation: { heading, pitch: camera.pitch, roll: 0 },
      duration,
      easingFunction: C.EasingFunction.CUBIC_IN_OUT
    });
    if (status !== 'complete') {
      viewer.scene.screenSpaceCameraController.enableInputs = true;
      setMode(MODES.OVERVIEW, 'CESIUM');
      finishMotion();
      return false;
    }
    resumeWalkAtLanding(target, heading);
    setMode(MODES.GROUND, 'WALK');
    finishMotion();
    return true;
  }

  function toggleMode() {
    if (isTransition()) return Promise.resolve(false);
    return (walk?.state?.active || state.mode === MODES.GROUND) ? toOverview() : toGround();
  }

  function cancelTransition() {
    if (!isTransition() || !viewer) return false;
    viewer.camera.cancelFlight?.();
    viewer.scene.screenSpaceCameraController.enableInputs = true;
    setMode(MODES.OVERVIEW, 'CESIUM');
    finishMotion();
    return true;
  }

  function startWalkRaf() {
    if (!walk || !walk.state.active) return;
    walk.state.speed = 2.8;
    walk.state.fast = 5.0;
    if (walk.state.timer) {
      clearInterval(walk.state.timer);
      walk.state.timer = 0;
    }
    if (state.rafId) return;
    state.rafLast = performance.now();
    const tick = (now) => {
      if (!walk?.state?.active) {
        state.rafId = 0;
        return;
      }
      const dt = Math.min(.05, Math.max(0, (now - state.rafLast) / 1000));
      state.rafLast = now;
      if (state.mode === MODES.GROUND) walk.stepControls(dt);
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  function wrapExternalCameraActions() {
    if (externalHandlersWrapped) return;
    externalHandlersWrapped = true;
    const wrap = (el) => {
      if (!el || typeof el.onclick !== 'function' || el.dataset.navWrapped === '1') return;
      const original = el.onclick;
      el.dataset.navWrapped = '1';
      el.onclick = function (event) {
        if (isTransition()) return;
        if (walk?.state?.active) walk.stop();
        viewer.scene.screenSpaceCameraController.enableInputs = true;
        setMode(MODES.OVERVIEW, 'CESIUM');
        return original.call(this, event);
      };
    };
    document.querySelectorAll('[data-place]').forEach(wrap);
    wrap(document.getElementById('home'));
    wrap(document.getElementById('top'));
  }

  function debug() {
    return {
      mode: state.mode,
      owner: state.owner,
      reducedMotion: state.reducedMotion,
      transitionStartedAt: state.transitionStartedAt,
      lastTransitionMs: state.lastTransitionMs,
      lastLanding: state.lastLanding,
      walkActive: !!walk?.state?.active,
      speed: walk?.state?.speed,
      fast: walk?.state?.fast,
      cesiumInputs: viewer?.scene?.screenSpaceCameraController?.enableInputs,
      rafActive: !!state.rafId
    };
  }

  function initialize() {
    viewer = window.__matsuyamaViewer || window.MatsuyamaApp?.viewer;
    walk = window.MatsuyamaWalk;
    if (!viewer || viewer.isDestroyed?.() || !walk) {
      setTimeout(initialize, 60);
      return;
    }
    if (state.initialized) return;
    state.initialized = true;
    walk.state.speed = 2.8;
    walk.state.fast = 5.0;
    installButton();
    wrapExternalCameraActions();
    window.addEventListener('matsuyama-walk-active', (event) => {
      if (event.detail) {
        setMode(MODES.GROUND, 'WALK');
        startWalkRaf();
      } else if (state.mode === MODES.GROUND) {
        setMode(MODES.OVERVIEW, 'CESIUM');
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyF' && !event.repeat && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
        event.preventDefault();
        toggleMode();
      } else if (event.code === 'Escape' && isTransition()) {
        event.preventDefault();
        cancelTransition();
      }
    }, { passive: false });
    if (walk.state.active) {
      setMode(MODES.GROUND, 'WALK');
      startWalkRaf();
    } else {
      setMode(MODES.OVERVIEW, 'CESIUM');
    }
    window.dispatchEvent(new CustomEvent('matsuyama-navigation-ready'));
  }

  window.MatsuyamaNavigation = { MODES, state, toOverview, toGround, toggleMode, cancelTransition, debug };
  initialize();
})();