'use strict';

(function installDisasterWalk() {
  if (!window.Cesium || window.__matsuyamaWalkInstalled) return;
  window.__matsuyamaWalkInstalled = true;
  const C = Cesium;
  let initialized = false;

  function captureViewer(viewer) {
    if (initialized || !viewer || !viewer.scene || !viewer.camera) return;
    initialized = true;
    window.__matsuyamaViewer = viewer;
    setTimeout(() => initWalk(viewer), 0);
  }

  for (const name of ['render', 'resize']) {
    const original = C.Viewer && C.Viewer.prototype && C.Viewer.prototype[name];
    if (typeof original !== 'function' || original.__matsuyamaWalkHook) continue;
    const wrapped = function (...args) {
      captureViewer(this);
      return original.apply(this, args);
    };
    wrapped.__matsuyamaWalkHook = true;
    C.Viewer.prototype[name] = wrapped;
  }

  function initWalk(viewer) {
    if (document.getElementById('walkToggle')) return;
    const main = document.querySelector('main');
    if (!main) return;

    const style = document.createElement('style');
    style.textContent = `
      #walkToggle{position:absolute;left:375px;top:18px;z-index:12;min-height:44px;padding:9px 14px;border:1px solid #70d7e8;border-radius:8px;background:#123950ee;color:#f2fbff;font:600 14px system-ui;box-shadow:0 8px 24px #0006;cursor:pointer}
      #walkToggle:hover,#walkToggle.active{background:#1f6683}
      #walkHud{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);z-index:12;min-width:min(560px,calc(100% - 32px));padding:10px 13px;border:1px solid #55748d;border-radius:10px;background:#0e2032e8;color:#eef7fb;box-shadow:0 10px 28px #0007;font:13px/1.45 system-ui;backdrop-filter:blur(5px)}
      #walkHud[hidden],#walkCrosshair[hidden],#walkTouch[hidden]{display:none!important}
      .walk-head{display:flex;gap:10px;justify-content:space-between;align-items:center}.walk-badges{display:flex;gap:6px;flex-wrap:wrap}.walk-badges span{padding:3px 7px;border-radius:999px;background:#173c55;border:1px solid #45667d;color:#cdeef5;font-size:11px}
      .walk-help{margin-top:6px;color:#c4d1dc;font-size:11.5px}.walk-help kbd{display:inline-block;padding:2px 5px;border:1px solid #65788b;border-bottom-width:2px;border-radius:4px;background:#172a3b;color:#fff;font:11px system-ui}
      #walkCrosshair{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%);z-index:12;pointer-events:none}
      #walkCrosshair:before,#walkCrosshair:after{content:"";position:absolute;background:#fff;box-shadow:0 0 3px #000}#walkCrosshair:before{left:8px;top:2px;width:2px;height:14px}#walkCrosshair:after{top:8px;left:2px;width:14px;height:2px}
      #walkTouch{position:absolute;inset:0;z-index:13;pointer-events:none;user-select:none;-webkit-user-select:none}
      .walk-stick-zone{position:absolute;bottom:max(18px,env(safe-area-inset-bottom));width:clamp(108px,28vw,136px);height:clamp(132px,34vw,158px);display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px;pointer-events:auto;touch-action:none}
      .walk-stick-zone.move{left:max(12px,env(safe-area-inset-left))}.walk-stick-zone.look{right:max(12px,env(safe-area-inset-right))}
      .walk-stick{position:relative;width:clamp(104px,26vw,128px);height:clamp(104px,26vw,128px);border-radius:50%;border:1px solid #9ac9db99;background:radial-gradient(circle at 50% 50%,#173d57a8 0 36%,#0b2237bb 37% 100%);box-shadow:0 8px 24px #0008,inset 0 0 0 1px #ffffff15}
      .walk-stick:before,.walk-stick:after{content:"";position:absolute;background:#bdebf033;pointer-events:none}.walk-stick:before{left:50%;top:12%;bottom:12%;width:1px}.walk-stick:after{top:50%;left:12%;right:12%;height:1px}
      .walk-stick-thumb{position:absolute;left:50%;top:50%;width:42%;height:42%;transform:translate(-50%,-50%);border-radius:50%;border:1px solid #d8f4ffcc;background:#2f7394e8;box-shadow:0 4px 12px #0008,inset 0 0 12px #9ce4f033;will-change:transform}
      .walk-stick-label{padding:2px 8px;border-radius:999px;background:#0b2135cc;color:#d7eef6;font:600 10px/1.4 system-ui;letter-spacing:.08em}
      .walk-mobile-actions{position:absolute;top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));display:flex;gap:7px;pointer-events:auto}
      .walk-mobile-actions button{min-height:40px;padding:7px 10px;border:1px solid #8cb4c7;border-radius:10px;background:#12344ee8;color:#fff;font:600 12px system-ui;box-shadow:0 5px 16px #0007;touch-action:manipulation}
      .walk-mobile-actions button.primary{border-color:#72d5e8;background:#1d5c79e8}
      @media(pointer:fine){#walkTouch{display:none!important}}
      @media(max-width:700px),(pointer:coarse){
        body.walk-mode-active header{display:none!important}
        body.walk-mode-active main{height:100dvh!important}
        body.walk-mode-active #panel,body.walk-mode-active #feature,body.walk-mode-active #message,body.walk-mode-active .mapbadge{display:none!important}
        body.walk-mode-active #map,body.walk-mode-active #map canvas{touch-action:none!important}
        body.walk-mode-active #walkToggle{display:none!important}
        #walkToggle{top:8px;right:8px;left:auto;min-height:40px;padding:7px 10px;font-size:12px}
        #walkHud{top:calc(max(10px,env(safe-area-inset-top)) + 48px);bottom:auto;min-width:0;width:min(92vw,560px);max-height:30vh;overflow:auto;padding:7px 9px;pointer-events:none}
        #walkHud .walk-head{gap:5px}#walkHud .walk-badges{gap:4px}#walkHud .walk-badges span{font-size:9.5px;padding:2px 5px}
        .walk-help{display:none}.mapbadge{display:none}
      }
    `;
    document.head.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = 'walkToggle';
    toggle.type = 'button';
    toggle.textContent = '🚶 防災ウォーク';
    main.appendChild(toggle);

    const hud = document.createElement('div');
    hud.id = 'walkHud';
    hud.hidden = true;
    hud.innerHTML = `<div class="walk-head"><strong>防災ウォーク</strong><div class="walk-badges"><span id="walkView">三人称</span><span id="walkSpeed">停止</span><span id="walkGround">地形追従</span></div></div><div class="walk-help"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移動　<kbd>←</kbd><kbd>→</kbd> カメラ旋回　<kbd>↑</kbd><kbd>↓</kbd> 視点上下　<kbd>V</kbd> 一/三人称　マウスドラッグ：三人称カメラ　<kbd>Esc</kbd> 終了</div>`;
    main.appendChild(hud);

    const crosshair = document.createElement('div');
    crosshair.id = 'walkCrosshair';
    crosshair.hidden = true;
    main.appendChild(crosshair);

    const touch = document.createElement('div');
    touch.id = 'walkTouch';
    touch.hidden = true;
    touch.innerHTML = `
      <div class="walk-mobile-actions">
        <button id="walkViewBtn" class="primary" type="button">視点：三人称</button>
        <button id="walkExitBtn" type="button">終了</button>
      </div>
      <div class="walk-stick-zone move" data-stick-zone="move" aria-label="移動スティック">
        <div class="walk-stick" id="walkMoveStick"><div class="walk-stick-thumb"></div></div>
        <span class="walk-stick-label">MOVE</span>
      </div>
      <div class="walk-stick-zone look" data-stick-zone="look" aria-label="視点スティック">
        <div class="walk-stick" id="walkLookStick"><div class="walk-stick-thumb"></div></div>
        <span class="walk-stick-label">CAMERA</span>
      </div>`;
    main.appendChild(touch);

    const state = {
      active:false, view:'third', lon:132.7657, lat:33.8392, ground:60,
      heading:C.Math.toRadians(15), cameraHeading:C.Math.toRadians(15),
      pitch:C.Math.toRadians(-4), cameraPitch:C.Math.toRadians(24), cameraDistance:8.6, eye:1.67,
      speed:2.2, fast:4.2, keys:new Set(), lastTick:0, lastTerrain:0,
      analog:{move:{x:0,y:0},look:{x:0,y:0}},
      avatar:null, shadow:null, line:null, timer:0, blockedUntil:0, lastSpeedText:'',
      oldInputs:true, oldCollision:true
    };

    const viewEl = hud.querySelector('#walkView');
    const speedEl = hud.querySelector('#walkSpeed');
    const groundEl = hud.querySelector('#walkGround');
    const viewBtn = touch.querySelector('#walkViewBtn');

    const avatarSvg = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="180" viewBox="0 0 96 180"><ellipse cx="48" cy="24" rx="17" ry="18" fill="#f1c8a8" stroke="#15384c" stroke-width="4"/><path d="M28 48Q48 38 68 48L73 103Q50 116 23 103Z" fill="#2b7ea1" stroke="#15384c" stroke-width="5"/><path d="M25 58L7 94M70 58L89 93" stroke="#f1c8a8" stroke-width="12" stroke-linecap="round"/><path d="M37 105L29 163M59 105L68 163" stroke="#293747" stroke-width="16" stroke-linecap="round"/><path d="M19 169H40M59 169H81" stroke="#17222c" stroke-width="10" stroke-linecap="round"/></svg>`);

    function pos(offset=0) {
      return C.Cartesian3.fromDegrees(state.lon, state.lat, state.ground + offset);
    }

    function axes(offset=0) {
      const origin = pos(offset);
      const m = C.Transforms.eastNorthUpToFixedFrame(origin);
      const col = (i) => {
        const v = C.Matrix4.getColumn(m, i, new C.Cartesian4());
        return new C.Cartesian3(v.x, v.y, v.z);
      };
      return { origin, east:col(0), north:col(1), up:col(2) };
    }

    function headingBasis(heading, offset=state.eye) {
      const a = axes(offset);
      const s = Math.sin(heading), c = Math.cos(heading);
      const forward = C.Cartesian3.normalize(
        C.Cartesian3.add(
          C.Cartesian3.multiplyByScalar(a.north, c, new C.Cartesian3()),
          C.Cartesian3.multiplyByScalar(a.east, s, new C.Cartesian3()),
          new C.Cartesian3()
        ), new C.Cartesian3()
      );
      const right = C.Cartesian3.normalize(
        C.Cartesian3.add(
          C.Cartesian3.multiplyByScalar(a.east, c, new C.Cartesian3()),
          C.Cartesian3.multiplyByScalar(a.north, -s, new C.Cartesian3()),
          new C.Cartesian3()
        ), new C.Cartesian3()
      );
      return { ...a, forward, right };
    }

    function basis() { return headingBasis(state.heading, state.eye); }

    function ensureAvatar() {
      if (state.avatar) return;
      state.shadow = viewer.entities.add({position:pos(.04),ellipse:{semiMajorAxis:.42,semiMinorAxis:.24,material:C.Color.BLACK.withAlpha(.35)}});
      state.line = viewer.entities.add({polyline:{positions:[pos(.08),pos(.08)],width:3,material:C.Color.CYAN.withAlpha(.8)}});
      state.avatar = viewer.entities.add({position:pos(.92),billboard:{image:avatarSvg,width:48,height:90,verticalOrigin:C.VerticalOrigin.BOTTOM,disableDepthTestDistance:250,scaleByDistance:new C.NearFarScalar(5,1.15,80,.7)}});
    }

    function updateAvatar() {
      if (!state.avatar) return;
      const show = state.active && state.view === 'third';
      state.avatar.show = show;
      state.shadow.show = show;
      state.line.show = show;
      state.avatar.position = pos(.92);
      state.shadow.position = pos(.04);
      const b = basis();
      const tip = C.Cartesian3.add(pos(.08), C.Cartesian3.multiplyByScalar(b.forward, 2, new C.Cartesian3()), new C.Cartesian3());
      state.line.polyline.positions = [pos(.08), tip];
    }

    function cameraPose() {
      if (state.view === 'first') {
        const b = headingBasis(state.heading, state.eye);
        const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
        const dir = C.Cartesian3.normalize(
          C.Cartesian3.add(
            C.Cartesian3.multiplyByScalar(b.forward, cp, new C.Cartesian3()),
            C.Cartesian3.multiplyByScalar(b.up, sp, new C.Cartesian3()),
            new C.Cartesian3()
          ), new C.Cartesian3()
        );
        const up = C.Cartesian3.normalize(C.Cartesian3.cross(b.right, dir, new C.Cartesian3()), new C.Cartesian3());
        viewer.camera.setView({destination:b.origin,orientation:{direction:dir,up}});
      } else {
        const b = headingBasis(state.cameraHeading, 1.25);
        const target = pos(1.25);
        const horizontal = Math.cos(state.cameraPitch) * state.cameraDistance;
        const vertical = Math.sin(state.cameraPitch) * state.cameraDistance;
        let cam = C.Cartesian3.subtract(target, C.Cartesian3.multiplyByScalar(b.forward, horizontal, new C.Cartesian3()), new C.Cartesian3());
        cam = C.Cartesian3.add(cam, C.Cartesian3.multiplyByScalar(b.up, vertical, new C.Cartesian3()), cam);
        const look = C.Cartesian3.normalize(C.Cartesian3.subtract(target, cam, new C.Cartesian3()), new C.Cartesian3());
        const up = C.Cartesian3.normalize(C.Cartesian3.cross(b.right, look, new C.Cartesian3()), new C.Cartesian3());
        viewer.camera.setView({destination:cam,orientation:{direction:look,up}});
      }
      viewer.scene.requestRender();
    }

    function globeHeight(lon, lat) {
      try {
        const h = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
        return Number.isFinite(h) ? h : null;
      } catch (_) { return null; }
    }

    async function refineTerrain() {
      if (!state.active) return;
      const now = performance.now();
      if (now - state.lastTerrain < 500) return;
      state.lastTerrain = now;
      try {
        const r = await C.sampleTerrainMostDetailed(viewer.terrainProvider, [C.Cartographic.fromDegrees(state.lon, state.lat)]);
        if (state.active && r[0] && Number.isFinite(r[0].height)) {
          state.ground = r[0].height;
          if(groundEl.textContent!=='地形追従')groundEl.textContent = '地形追従';
          updateAvatar(); cameraPose();
        }
      } catch (_) {
        const h = globeHeight(state.lon, state.lat);
        if (h !== null) state.ground = h;
        else groundEl.textContent = '地形読込中';
      }
    }

    function blocked(worldDir, step) {
      if (typeof viewer.scene.pickFromRay !== 'function' || step < .02) return false;
      try {
        const origin = pos(.9);
        const ray = new C.Ray(origin, C.Cartesian3.normalize(worldDir, new C.Cartesian3()));
        const hit = viewer.scene.pickFromRay(ray);
        if (!hit || !hit.position) return false;
        if (hit.object && !(hit.object instanceof C.Cesium3DTileFeature)) return false;
        if (C.Cartesian3.distance(origin, hit.position) < Math.max(.85, step + .55)) {
          state.blockedUntil = performance.now() + 450;
          return true;
        }
      } catch (_) {}
      return false;
    }

    function move(east, north) {
      const R = 6378137;
      const latr = C.Math.toRadians(state.lat);
      const lat = state.lat + C.Math.toDegrees(north / R);
      const lon = state.lon + C.Math.toDegrees(east / (R * Math.max(.15, Math.cos(latr))));
      if (lon < 132.45 || lon > 132.97 || lat < 33.65 || lat > 34.13) return;
      state.lon = lon;
      state.lat = lat;
      const h = globeHeight(lon, lat);
      if (h !== null && Math.abs(h - state.ground) < 4.5) state.ground = h;
      refineTerrain();
    }

    function keyboardMove() {
      return {
        x:(state.keys.has('KeyD') ? 1 : 0) - (state.keys.has('KeyA') ? 1 : 0),
        y:(state.keys.has('KeyW') ? 1 : 0) - (state.keys.has('KeyS') ? 1 : 0)
      };
    }

    function setVirtualStick(kind, x=0, y=0) {
      if (!state.analog[kind]) return;
      state.analog[kind].x = C.Math.clamp(Number(x) || 0, -1, 1);
      state.analog[kind].y = C.Math.clamp(Number(y) || 0, -1, 1);
    }

    function setSpeedText(text){if(state.lastSpeedText===text)return;state.lastSpeedText=text;speedEl.textContent=text;}

    function stepControls(dt = 1 / 30) {
      if (!state.active) return;
      dt = C.Math.clamp(Number(dt) || 0, 0, .05);
      const turn = C.Math.toRadians(95);
      const look = C.Math.toRadians(70);
      let poseChanged=false, avatarChanged=false;

      let lookX = state.analog.look.x;
      let lookY = state.analog.look.y;
      if (state.keys.has('ArrowLeft')) lookX -= 1;
      if (state.keys.has('ArrowRight')) lookX += 1;
      if (state.keys.has('ArrowUp')) lookY += 1;
      if (state.keys.has('ArrowDown')) lookY -= 1;
      lookX = C.Math.clamp(lookX, -1, 1);
      lookY = C.Math.clamp(lookY, -1, 1);
      poseChanged = !!(lookX || lookY);

      if (state.view === 'first') {
        state.heading = C.Math.zeroToTwoPi(state.heading + lookX * turn * dt);
        state.cameraHeading = state.heading;
        state.pitch = C.Math.clamp(state.pitch + lookY * look * dt, C.Math.toRadians(-45), C.Math.toRadians(35));
      } else {
        state.cameraHeading = C.Math.zeroToTwoPi(state.cameraHeading + lookX * turn * dt);
        state.cameraPitch = C.Math.clamp(state.cameraPitch - lookY * look * .75 * dt, C.Math.toRadians(7), C.Math.toRadians(58));
      }

      const k = keyboardMove();
      let r = C.Math.clamp(k.x + state.analog.move.x, -1, 1);
      let f = C.Math.clamp(k.y + state.analog.move.y, -1, 1);
      if (f || r) {
        const mag = Math.hypot(f, r);
        if (mag > 1) { f /= mag; r /= mag; }
        const analogMagnitude = Math.min(1, Math.hypot(state.analog.move.x, state.analog.move.y));
        const keyboardActive = !!(k.x || k.y);
        const throttle = keyboardActive ? 1 : Math.max(.18, analogMagnitude);
        const fast = state.keys.has('ShiftLeft') || state.keys.has('ShiftRight');
        const speed = (fast ? state.fast : state.speed) * throttle;
        const dist = speed * dt;
        const moveHeading = state.view === 'third' ? state.cameraHeading : state.heading;
        const e = Math.sin(moveHeading) * f * dist + Math.cos(moveHeading) * r * dist;
        const n = Math.cos(moveHeading) * f * dist - Math.sin(moveHeading) * r * dist;
        const b = axes(state.eye);
        const wd = C.Cartesian3.add(
          C.Cartesian3.multiplyByScalar(b.east, e, new C.Cartesian3()),
          C.Cartesian3.multiplyByScalar(b.north, n, new C.Cartesian3()),
          new C.Cartesian3()
        );
        if (state.view === 'third' && Math.hypot(e, n) > 1e-6) state.heading = C.Math.zeroToTwoPi(Math.atan2(e, n));
        setSpeedText(`${fast ? '早歩き' : '歩行'} ${speed.toFixed(1)} m/s`);
        if (!blocked(wd, dist)) { move(e, n); poseChanged=true; avatarChanged=true; }
      } else {
        setSpeedText('停止');
      }

      if (performance.now() < state.blockedUntil) setSpeedText('建物前で停止');
      if (avatarChanged) updateAvatar();
      if (poseChanged) cameraPose();
    }

    function controlTick() {
      if (!state.active) return;
      const now = performance.now();
      const dt = state.lastTick ? Math.min(.05, Math.max(0, (now - state.lastTick) / 1000)) : 1 / 30;
      state.lastTick = now;
      stepControls(dt);
    }

    function setView(mode) {
      state.view = mode;
      if (mode === 'first') {
        state.heading = state.cameraHeading;
        viewEl.textContent = '一人称';
        viewBtn.textContent = '視点：一人称';
      } else {
        state.cameraHeading = state.heading;
        viewEl.textContent = '三人称';
        viewBtn.textContent = '視点：三人称';
      }
      crosshair.hidden = !state.active || mode !== 'first';
      updateAvatar();
      cameraPose();
    }

    function toggleView() { setView(state.view === 'first' ? 'third' : 'first'); }

    function resetAnalog() {
      setVirtualStick('move', 0, 0);
      setVirtualStick('look', 0, 0);
      for (const thumb of touch.querySelectorAll('.walk-stick-thumb')) thumb.style.transform = 'translate(-50%,-50%)';
    }

    function start() {
      if (state.active) return;
      state.active = true;
      state.lastSpeedText='';
      ensureAvatar();
      state.oldInputs = viewer.scene.screenSpaceCameraController.enableInputs;
      state.oldCollision = viewer.scene.screenSpaceCameraController.enableCollisionDetection;
      viewer.scene.screenSpaceCameraController.enableInputs = false;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
      const card = document.getElementById('feature');
      if (card) card.hidden = true;
      document.body.classList.add('walk-mode-active');
      toggle.classList.add('active');
      toggle.textContent = '■ ウォーク終了';
      hud.hidden = false;
      touch.hidden = false;
      state.lastTick = performance.now();
      state.cameraHeading = state.heading;
      resetAnalog();
      const h = globeHeight(state.lon, state.lat);
      if (h !== null) state.ground = h;
      setView('third');
      refineTerrain();
      clearInterval(state.timer);
      state.timer = window.setInterval(controlTick, 1000 / 30);
      stepControls(0);
      window.dispatchEvent(new CustomEvent('matsuyama-walk-active',{detail:true}));
    }

    function stop() {
      if (!state.active) return;
      state.active = false;
      state.keys.clear();
      resetAnalog();
      clearInterval(state.timer);
      state.timer = 0;
      if (document.pointerLockElement === viewer.canvas) document.exitPointerLock?.();
      viewer.scene.screenSpaceCameraController.enableInputs = state.oldInputs;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = state.oldCollision;
      document.body.classList.remove('walk-mode-active');
      toggle.classList.remove('active');
      toggle.textContent = '🚶 防災ウォーク';
      hud.hidden = true;
      touch.hidden = true;
      crosshair.hidden = true;
      updateAvatar();
      viewer.scene.requestRender();
      window.dispatchEvent(new CustomEvent('matsuyama-walk-active',{detail:false}));
    }

    function bindStick(zone, kind) {
      const stick = zone.querySelector('.walk-stick');
      const thumb = zone.querySelector('.walk-stick-thumb');
      let pointerId = null, stickRect = null;
      const update = (e) => {
        const rect = stickRect || (stickRect=stick.getBoundingClientRect());
        const radius = Math.max(1, rect.width * .36);
        let dx = e.clientX - (rect.left + rect.width / 2);
        let dy = e.clientY - (rect.top + rect.height / 2);
        const d = Math.hypot(dx, dy);
        if (d > radius) { dx *= radius / d; dy *= radius / d; }
        setVirtualStick(kind, dx / radius, -dy / radius);
        thumb.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px),calc(-50% + ${dy.toFixed(1)}px))`;
      };
      const end = (e) => {
        if (pointerId === null || (e && e.pointerId !== undefined && e.pointerId !== pointerId)) return;
        pointerId = null; stickRect = null;
        setVirtualStick(kind, 0, 0);
        thumb.style.transform = 'translate(-50%,-50%)';
      };
      zone.addEventListener('pointerdown', (e) => {
        if (!state.active) return;
        e.preventDefault(); e.stopPropagation();
        pointerId = e.pointerId; stickRect = stick.getBoundingClientRect();
        zone.setPointerCapture?.(e.pointerId);
        update(e);
      }, { passive:false });
      zone.addEventListener('pointermove', (e) => {
        if (!state.active || pointerId !== e.pointerId) return;
        e.preventDefault(); e.stopPropagation(); update(e);
      }, { passive:false });
      for (const type of ['pointerup','pointercancel','lostpointercapture']) {
        zone.addEventListener(type, (e) => {
          if (state.active) { e.preventDefault?.(); e.stopPropagation?.(); }
          end(e);
        }, { passive:false });
      }
    }

    toggle.onclick = () => state.active ? stop() : start();
    viewBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleView(); };
    touch.querySelector('#walkExitBtn').onclick = (e) => { e.preventDefault(); e.stopPropagation(); stop(); };
    bindStick(touch.querySelector('[data-stick-zone="move"]'), 'move');
    bindStick(touch.querySelector('[data-stick-zone="look"]'), 'look');

    const captured = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','ShiftLeft','ShiftRight']);
    window.addEventListener('keydown', (e) => {
      if (!state.active) return;
      if (e.code === 'Escape') { stop(); return; }
      if (e.code === 'KeyV') { e.preventDefault(); toggleView(); return; }
      if (captured.has(e.code)) { e.preventDefault(); state.keys.add(e.code); }
    }, { passive:false });
    window.addEventListener('keyup', (e) => state.keys.delete(e.code));
    window.addEventListener('blur', () => { state.keys.clear(); resetAnalog(); });

    let dragLook = null;
    viewer.canvas.addEventListener('pointerdown', (e) => {
      if (!state.active) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.pointerType === 'mouse' && state.view === 'first' && matchMedia('(pointer:fine)').matches) {
        if (document.pointerLockElement !== viewer.canvas) viewer.canvas.requestPointerLock?.();
        return;
      }
      dragLook = { id:e.pointerId, x:e.clientX, y:e.clientY };
      viewer.canvas.setPointerCapture?.(e.pointerId);
    }, true);

    viewer.canvas.addEventListener('pointermove', (e) => {
      if (!state.active || !dragLook || e.pointerId !== dragLook.id) return;
      const dx = e.clientX - dragLook.x;
      const dy = e.clientY - dragLook.y;
      dragLook.x = e.clientX; dragLook.y = e.clientY;
      if (state.view === 'third') {
        state.cameraHeading = C.Math.zeroToTwoPi(state.cameraHeading + dx * .005);
        state.cameraPitch = C.Math.clamp(state.cameraPitch + dy * .0035, C.Math.toRadians(7), C.Math.toRadians(58));
      } else if (document.pointerLockElement !== viewer.canvas) {
        state.heading = C.Math.zeroToTwoPi(state.heading + dx * .0045);
        state.cameraHeading = state.heading;
        state.pitch = C.Math.clamp(state.pitch - dy * .0035, C.Math.toRadians(-45), C.Math.toRadians(35));
      }
      cameraPose();
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);

    for (const type of ['pointerup','pointercancel']) {
      viewer.canvas.addEventListener(type, (e) => {
        if (!state.active) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (dragLook && e.pointerId === dragLook.id) dragLook = null;
      }, true);
    }

    for (const type of ['click','mousedown','mouseup','dblclick','touchstart','touchmove','touchend']) {
      viewer.canvas.addEventListener(type, (e) => {
        if (!state.active) return;
        e.preventDefault(); e.stopImmediatePropagation();
      }, { capture:true, passive:false });
    }

    document.addEventListener('mousemove', (e) => {
      if (!state.active || state.view !== 'first' || document.pointerLockElement !== viewer.canvas) return;
      state.heading = C.Math.zeroToTwoPi(state.heading + e.movementX * .0024);
      state.cameraHeading = state.heading;
      state.pitch = C.Math.clamp(state.pitch - e.movementY * .0019, C.Math.toRadians(-45), C.Math.toRadians(35));
      cameraPose();
    });

    window.MatsuyamaWalk = { start, stop, toggleView, setView, setVirtualStick, stepControls, state };
  }
})();
