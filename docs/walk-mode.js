'use strict';

(function installDisasterWalk() {
  if (!window.Cesium || !Cesium.Viewer || window.__matsuyamaWalkInstalled) return;
  window.__matsuyamaWalkInstalled = true;

  const C = Cesium;
  const OriginalViewer = C.Viewer;
  let walkInitScheduled = false;

  C.Viewer = new Proxy(OriginalViewer, {
    construct(target, args) {
      const viewer = Reflect.construct(target, args, target);
      window.__matsuyamaViewer = viewer;
      if (!walkInitScheduled) {
        walkInitScheduled = true;
        setTimeout(() => initWalkMode(viewer), 0);
      }
      return viewer;
    }
  });

  function initWalkMode(viewer) {
    if (!viewer || viewer.isDestroyed() || document.getElementById('walkToggle')) return;

    const css = document.createElement('style');
    css.textContent = `
      #walkToggle{position:absolute;left:375px;top:18px;z-index:7;min-height:44px;padding:9px 14px;border:1px solid #70d7e8;border-radius:8px;background:#123950ee;color:#f2fbff;font:600 14px/1.2 system-ui,-apple-system,"Noto Sans JP",sans-serif;box-shadow:0 8px 24px #0006;cursor:pointer}
      #walkToggle:hover,#walkToggle.active{background:#1f6683}
      #walkHud{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);z-index:7;min-width:min(560px,calc(100% - 32px));max-width:760px;padding:10px 13px;border:1px solid #55748d;border-radius:10px;background:#0e2032e8;color:#eef7fb;box-shadow:0 10px 28px #0007;font:13px/1.4 system-ui,-apple-system,"Noto Sans JP",sans-serif;backdrop-filter:blur(5px)}
      #walkHud[hidden]{display:none!important}.walk-head{display:flex;gap:10px;align-items:center;justify-content:space-between}.walk-head strong{font-size:14px}.walk-badges{display:flex;gap:6px;flex-wrap:wrap}.walk-badges span{padding:3px 7px;border-radius:999px;background:#173c55;border:1px solid #45667d;color:#cdeef5;font-size:11px}.walk-help{margin-top:6px;color:#c4d1dc;font-size:11.5px}.walk-help kbd{display:inline-block;min-width:20px;padding:2px 5px;border:1px solid #65788b;border-bottom-width:2px;border-radius:4px;background:#172a3b;color:#fff;text-align:center;font:11px system-ui}
      #walkCrosshair{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%);z-index:7;pointer-events:none}#walkCrosshair::before,#walkCrosshair::after{content:"";position:absolute;background:#fff;box-shadow:0 0 3px #000}#walkCrosshair::before{left:8px;top:2px;width:2px;height:14px}#walkCrosshair::after{top:8px;left:2px;width:14px;height:2px}
      #walkTouch{position:absolute;inset:0;z-index:7;pointer-events:none}#walkTouch[hidden]{display:none!important}.walk-pad{position:absolute;bottom:30px;display:grid;grid-template-columns:repeat(3,52px);grid-template-rows:repeat(2,52px);gap:6px;pointer-events:auto}.walk-pad.left{left:16px}.walk-pad.right{right:16px;grid-template-columns:repeat(2,58px);grid-template-rows:repeat(2,52px)}.walk-pad button{min-height:52px;border:1px solid #8cb4c7;border-radius:12px;background:#12344ed9;color:#fff;font-size:20px;touch-action:none}.walk-pad button:active{background:#287393}.walk-pad .forward{grid-column:2;grid-row:1}.walk-pad .leftward{grid-column:1;grid-row:2}.walk-pad .back{grid-column:2;grid-row:2}.walk-pad .rightward{grid-column:3;grid-row:2}.walk-pad.right .turnLeft{grid-column:1;grid-row:1}.walk-pad.right .turnRight{grid-column:2;grid-row:1}.walk-pad.right .view{grid-column:1;grid-row:2;font-size:12px}.walk-pad.right .exit{grid-column:2;grid-row:2;font-size:12px}
      @media(max-width:700px){#walkToggle{top:8px;right:8px;left:auto;min-height:40px;padding:7px 10px;font-size:12px}#walkHud{bottom:146px;min-width:calc(100% - 20px);padding:8px 10px}.walk-help{display:none}.mapbadge{display:none}.walk-pad{bottom:18px}.walk-pad.left{left:10px}.walk-pad.right{right:10px}}
      @media(pointer:fine){#walkTouch{display:none!important}}
    `;
    document.head.appendChild(css);

    const toggle = document.createElement('button');
    toggle.id = 'walkToggle';
    toggle.type = 'button';
    toggle.textContent = '🚶 防災ウォーク';
    toggle.title = '松山市を歩く（一人称 / 三人称）';
    document.querySelector('main').appendChild(toggle);

    const hud = document.createElement('div');
    hud.id = 'walkHud';
    hud.hidden = true;
    hud.innerHTML = `
      <div class="walk-head"><strong>防災ウォーク</strong><div class="walk-badges"><span id="walkViewBadge">三人称</span><span id="walkSpeedBadge">歩行 2.2 m/s</span><span id="walkAltBadge">地形追従</span></div></div>
      <div class="walk-help"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移動　<kbd>←</kbd><kbd>→</kbd> 向き　<kbd>↑</kbd><kbd>↓</kbd> 視線　<kbd>V</kbd> 視点切替　<kbd>Shift</kbd> 早歩き　<kbd>Esc</kbd> 終了　（一人称は地図上クリックでマウス視点）</div>`;
    document.querySelector('main').appendChild(hud);

    const crosshair = document.createElement('div');
    crosshair.id = 'walkCrosshair';
    crosshair.hidden = true;
    document.querySelector('main').appendChild(crosshair);

    const touch = document.createElement('div');
    touch.id = 'walkTouch';
    touch.hidden = true;
    touch.innerHTML = `
      <div class="walk-pad left">
        <button class="forward" data-walk-key="KeyW" aria-label="前進">▲</button>
        <button class="leftward" data-walk-key="KeyA" aria-label="左移動">◀</button>
        <button class="back" data-walk-key="KeyS" aria-label="後退">▼</button>
        <button class="rightward" data-walk-key="KeyD" aria-label="右移動">▶</button>
      </div>
      <div class="walk-pad right">
        <button class="turnLeft" data-walk-key="ArrowLeft" aria-label="左を向く">↶</button>
        <button class="turnRight" data-walk-key="ArrowRight" aria-label="右を向く">↷</button>
        <button class="view" id="walkTouchView">一/三人称</button>
        <button class="exit" id="walkTouchExit">終了</button>
      </div>`;
    document.querySelector('main').appendChild(touch);

    const state = {
      active: false,
      view: 'third',
      lon: 132.7657,
      lat: 33.8392,
      ground: 60,
      heading: C.Math.toRadians(15),
      pitch: C.Math.toRadians(-4),
      eye: 1.67,
      speed: 2.2,
      fastSpeed: 4.2,
      thirdBack: 7.5,
      thirdUp: 3.8,
      keys: new Set(),
      lastTime: 0,
      avatar: null,
      shadow: null,
      headingLine: null,
      savedCameraInputs: true,
      savedCollision: true,
      lastGroundUpdate: 0,
      blockedUntil: 0,
      animationFrame: 0
    };

    const viewBadge = hud.querySelector('#walkViewBadge');
    const speedBadge = hud.querySelector('#walkSpeedBadge');
    const altBadge = hud.querySelector('#walkAltBadge');

    function humanSvg() {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="180" viewBox="0 0 96 180"><ellipse cx="48" cy="24" rx="17" ry="18" fill="#f1c8a8" stroke="#15384c" stroke-width="4"/><path d="M28 48 Q48 38 68 48 L73 103 Q50 116 23 103Z" fill="#2b7ea1" stroke="#15384c" stroke-width="5"/><path d="M25 58 L7 94" stroke="#f1c8a8" stroke-width="12" stroke-linecap="round"/><path d="M70 58 L89 93" stroke="#f1c8a8" stroke-width="12" stroke-linecap="round"/><path d="M37 105 L29 163" stroke="#293747" stroke-width="16" stroke-linecap="round"/><path d="M59 105 L68 163" stroke="#293747" stroke-width="16" stroke-linecap="round"/><path d="M19 169 H40" stroke="#17222c" stroke-width="10" stroke-linecap="round"/><path d="M59 169 H81" stroke="#17222c" stroke-width="10" stroke-linecap="round"/></svg>`;
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    function positionCartesian(heightOffset = 0) {
      return C.Cartesian3.fromDegrees(state.lon, state.lat, state.ground + heightOffset);
    }

    function enuAxes(heightOffset = 0) {
      const origin = positionCartesian(heightOffset);
      const m = C.Transforms.eastNorthUpToFixedFrame(origin);
      const east = C.Matrix4.getColumn(m, 0, new C.Cartesian4());
      const north = C.Matrix4.getColumn(m, 1, new C.Cartesian4());
      const up = C.Matrix4.getColumn(m, 2, new C.Cartesian4());
      return {
        origin,
        east: new C.Cartesian3(east.x, east.y, east.z),
        north: new C.Cartesian3(north.x, north.y, north.z),
        up: new C.Cartesian3(up.x, up.y, up.z)
      };
    }

    function horizontalVectors() {
      const a = enuAxes(state.eye);
      const sh = Math.sin(state.heading), ch = Math.cos(state.heading);
      const forward = C.Cartesian3.add(
        C.Cartesian3.multiplyByScalar(a.north, ch, new C.Cartesian3()),
        C.Cartesian3.multiplyByScalar(a.east, sh, new C.Cartesian3()),
        new C.Cartesian3()
      );
      const right = C.Cartesian3.add(
        C.Cartesian3.multiplyByScalar(a.east, ch, new C.Cartesian3()),
        C.Cartesian3.multiplyByScalar(a.north, -sh, new C.Cartesian3()),
        new C.Cartesian3()
      );
      return { ...a, forward: C.Cartesian3.normalize(forward, forward), right: C.Cartesian3.normalize(right, right) };
    }

    function updateAvatar() {
      if (!state.avatar) return;
      state.avatar.position = positionCartesian(0.92);
      state.avatar.show = state.active && state.view === 'third';
      state.shadow.position = positionCartesian(0.04);
      state.shadow.show = state.active && state.view === 'third';
      const v = horizontalVectors();
      const tip = C.Cartesian3.add(v.origin, C.Cartesian3.multiplyByScalar(v.forward, 2.1, new C.Cartesian3()), new C.Cartesian3());
      state.headingLine.polyline.positions = [positionCartesian(0.08), tip];
      state.headingLine.show = state.active && state.view === 'third';
    }

    function ensureAvatar() {
      if (state.avatar) return;
      state.shadow = viewer.entities.add({
        position: positionCartesian(0.03),
        ellipse: { semiMajorAxis: 0.42, semiMinorAxis: 0.24, material: C.Color.BLACK.withAlpha(0.36), heightReference: C.HeightReference.NONE }
      });
      state.headingLine = viewer.entities.add({
        polyline: { positions: [positionCartesian(0.08), positionCartesian(0.08)], width: 3, material: C.Color.CYAN.withAlpha(0.8) }
      });
      state.avatar = viewer.entities.add({
        position: positionCartesian(0.92),
        billboard: {
          image: humanSvg(), width: 48, height: 90, verticalOrigin: C.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: 250, scaleByDistance: new C.NearFarScalar(5, 1.15, 80, 0.7)
        }
      });
    }

    function cameraPose() {
      const v = horizontalVectors();
      const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
      const direction = C.Cartesian3.add(
        C.Cartesian3.multiplyByScalar(v.forward, cp, new C.Cartesian3()),
        C.Cartesian3.multiplyByScalar(v.up, sp, new C.Cartesian3()),
        new C.Cartesian3()
      );
      C.Cartesian3.normalize(direction, direction);

      if (state.view === 'first') {
        const cameraUp = C.Cartesian3.normalize(C.Cartesian3.cross(v.right, direction, new C.Cartesian3()), new C.Cartesian3());
        viewer.camera.setView({ destination: v.origin, orientation: { direction, up: cameraUp } });
      } else {
        const target = C.Cartesian3.add(positionCartesian(1.25), C.Cartesian3.multiplyByScalar(v.forward, 1.2, new C.Cartesian3()), new C.Cartesian3());
        let cameraPos = C.Cartesian3.subtract(target, C.Cartesian3.multiplyByScalar(v.forward, state.thirdBack, new C.Cartesian3()), new C.Cartesian3());
        cameraPos = C.Cartesian3.add(cameraPos, C.Cartesian3.multiplyByScalar(v.up, state.thirdUp, new C.Cartesian3()), cameraPos);
        const look = C.Cartesian3.normalize(C.Cartesian3.subtract(target, cameraPos, new C.Cartesian3()), new C.Cartesian3());
        const cameraUp = C.Cartesian3.normalize(C.Cartesian3.cross(v.right, look, new C.Cartesian3()), new C.Cartesian3());
        viewer.camera.setView({ destination: cameraPos, orientation: { direction: look, up: cameraUp } });
      }
      viewer.scene.requestRender();
    }

    function synchronousGround(lon, lat) {
      try {
        const h = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
        return Number.isFinite(h) ? h : null;
      } catch (_) {
        return null;
      }
    }

    async function refineGround() {
      if (!state.active) return;
      const now = performance.now();
      if (now - state.lastGroundUpdate < 500) return;
      state.lastGroundUpdate = now;
      try {
        const sampled = await C.sampleTerrainMostDetailed(viewer.terrainProvider, [C.Cartographic.fromDegrees(state.lon, state.lat)]);
        if (!state.active || !sampled[0] || !Number.isFinite(sampled[0].height)) return;
        state.ground = sampled[0].height;
        altBadge.textContent = '地形追従';
        updateAvatar();
        cameraPose();
      } catch (_) {
        const h = synchronousGround(state.lon, state.lat);
        if (h !== null) {
          state.ground = h;
          altBadge.textContent = '地形追従';
        } else {
          altBadge.textContent = '地形読込中';
        }
      }
    }

    function collisionBlocked(worldDirection, step) {
      if (typeof viewer.scene.pickFromRay !== 'function' || step <= 0.02) return false;
      try {
        const origin = positionCartesian(0.9);
        const ray = new C.Ray(origin, C.Cartesian3.normalize(worldDirection, new C.Cartesian3()));
        const hit = viewer.scene.pickFromRay(ray);
        if (!hit || !hit.position) return false;
        if (hit.object && !(hit.object instanceof C.Cesium3DTileFeature)) return false;
        const dist = C.Cartesian3.distance(origin, hit.position);
        if (dist < Math.max(0.85, step + 0.55)) {
          state.blockedUntil = performance.now() + 450;
          return true;
        }
      } catch (_) {}
      return false;
    }

    function moveBy(eastMeters, northMeters) {
      const latRad = C.Math.toRadians(state.lat);
      const radius = 6378137;
      const newLat = state.lat + C.Math.toDegrees(northMeters / radius);
      const newLon = state.lon + C.Math.toDegrees(eastMeters / (radius * Math.max(0.15, Math.cos(latRad))));
      if (newLon < 132.45 || newLon > 132.97 || newLat < 33.65 || newLat > 34.13) return;
      state.lon = newLon;
      state.lat = newLat;
      const h = synchronousGround(newLon, newLat);
      if (h !== null && Math.abs(h - state.ground) < 4.5) state.ground = h;
      updateAvatar();
      refineGround();
    }

    function frame(t) {
      if (!state.active) return;
      const dt = state.lastTime ? Math.min(0.05, (t - state.lastTime) / 1000) : 0;
      state.lastTime = t;

      const turnRate = C.Math.toRadians(80);
      const lookRate = C.Math.toRadians(55);
      if (state.keys.has('ArrowLeft')) state.heading -= turnRate * dt;
      if (state.keys.has('ArrowRight')) state.heading += turnRate * dt;
      if (state.keys.has('ArrowUp')) state.pitch = Math.min(C.Math.toRadians(35), state.pitch + lookRate * dt);
      if (state.keys.has('ArrowDown')) state.pitch = Math.max(C.Math.toRadians(-45), state.pitch - lookRate * dt);
      state.heading = C.Math.zeroToTwoPi(state.heading);

      let f = 0, r = 0;
      if (state.keys.has('KeyW')) f += 1;
      if (state.keys.has('KeyS')) f -= 1;
      if (state.keys.has('KeyD')) r += 1;
      if (state.keys.has('KeyA')) r -= 1;
      if (f || r) {
        const mag = Math.hypot(f, r); f /= mag; r /= mag;
        const speed = state.keys.has('ShiftLeft') || state.keys.has('ShiftRight') ? state.fastSpeed : state.speed;
        speedBadge.textContent = `${speed > state.speed ? '早歩き' : '歩行'} ${speed.toFixed(1)} m/s`;
        const dist = speed * dt;
        const east = Math.sin(state.heading) * f * dist + Math.cos(state.heading) * r * dist;
        const north = Math.cos(state.heading) * f * dist - Math.sin(state.heading) * r * dist;
        const v = horizontalVectors();
        const worldDir = C.Cartesian3.add(
          C.Cartesian3.multiplyByScalar(v.east, east, new C.Cartesian3()),
          C.Cartesian3.multiplyByScalar(v.north, north, new C.Cartesian3()),
          new C.Cartesian3()
        );
        if (!collisionBlocked(worldDir, dist)) moveBy(east, north);
      } else {
        speedBadge.textContent = '停止';
      }

      if (performance.now() < state.blockedUntil) speedBadge.textContent = '建物前で停止';
      updateAvatar();
      cameraPose();
      state.animationFrame = requestAnimationFrame(frame);
    }

    function setView(mode) {
      state.view = mode === 'first' ? 'first' : 'third';
      viewBadge.textContent = state.view === 'first' ? '一人称' : '三人称';
      crosshair.hidden = !state.active || state.view !== 'first';
      updateAvatar();
      cameraPose();
    }

    function toggleView() {
      setView(state.view === 'first' ? 'third' : 'first');
    }

    function start() {
      if (state.active) return;
      state.active = true;
      const featureCard = document.getElementById('feature');
      if (featureCard) featureCard.hidden = true;
      ensureAvatar();
      state.savedCameraInputs = viewer.scene.screenSpaceCameraController.enableInputs;
      state.savedCollision = viewer.scene.screenSpaceCameraController.enableCollisionDetection;
      viewer.scene.screenSpaceCameraController.enableInputs = false;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
      toggle.classList.add('active');
      toggle.textContent = '■ ウォーク終了';
      hud.hidden = false;
      touch.hidden = false;
      state.lastTime = 0;
      const h = synchronousGround(state.lon, state.lat);
      if (h !== null) state.ground = h;
      refineGround();
      setView('third');
      state.animationFrame = requestAnimationFrame(frame);
    }

    function stop() {
      if (!state.active) return;
      state.active = false;
      state.keys.clear();
      cancelAnimationFrame(state.animationFrame);
      if (document.pointerLockElement === viewer.canvas) document.exitPointerLock?.();
      viewer.scene.screenSpaceCameraController.enableInputs = state.savedCameraInputs;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = state.savedCollision;
      toggle.classList.remove('active');
      toggle.textContent = '🚶 防災ウォーク';
      hud.hidden = true;
      touch.hidden = true;
      crosshair.hidden = true;
      updateAvatar();
      viewer.scene.requestRender();
    }

    toggle.addEventListener('click', () => state.active ? stop() : start());
    touch.querySelector('#walkTouchView').addEventListener('click', toggleView);
    touch.querySelector('#walkTouchExit').addEventListener('click', stop);

    const keysToCapture = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','ShiftLeft','ShiftRight']);
    window.addEventListener('keydown', (e) => {
      if (!state.active) return;
      if (e.code === 'Escape') { stop(); return; }
      if (e.code === 'KeyV') { e.preventDefault(); toggleView(); return; }
      if (keysToCapture.has(e.code)) { e.preventDefault(); state.keys.add(e.code); }
    }, { passive: false });
    window.addEventListener('keyup', (e) => { if (state.active) state.keys.delete(e.code); });
    window.addEventListener('blur', () => state.keys.clear());

    touch.querySelectorAll('[data-walk-key]').forEach((button) => {
      const code = button.dataset.walkKey;
      const on = (e) => { if (!state.active) return; e.preventDefault(); state.keys.add(code); button.setPointerCapture?.(e.pointerId); };
      const off = (e) => { e.preventDefault(); state.keys.delete(code); };
      button.addEventListener('pointerdown', on, { passive: false });
      button.addEventListener('pointerup', off, { passive: false });
      button.addEventListener('pointercancel', off, { passive: false });
      button.addEventListener('pointerleave', (e) => { if (e.buttons === 0) off(e); }, { passive: false });
    });

    viewer.canvas.addEventListener('click', (e) => {
      if (!state.active) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (state.view === 'first' && document.pointerLockElement !== viewer.canvas && matchMedia('(pointer:fine)').matches) {
        viewer.canvas.requestPointerLock?.();
      }
    }, true);
    for (const type of ['mousedown','mouseup','dblclick']) {
      viewer.canvas.addEventListener(type, (e) => {
        if (state.active) { e.preventDefault(); e.stopImmediatePropagation(); }
      }, true);
    }
    document.addEventListener('mousemove', (e) => {
      if (!state.active || state.view !== 'first' || document.pointerLockElement !== viewer.canvas) return;
      state.heading = C.Math.zeroToTwoPi(state.heading + e.movementX * 0.0024);
      state.pitch = C.Math.clamp(state.pitch - e.movementY * 0.0019, C.Math.toRadians(-45), C.Math.toRadians(35));
    });

    let touchLook = null;
    viewer.canvas.addEventListener('pointerdown', (e) => {
      if (!state.active || e.pointerType !== 'touch') return;
      touchLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
      viewer.canvas.setPointerCapture?.(e.pointerId);
    }, true);
    viewer.canvas.addEventListener('pointermove', (e) => {
      if (!state.active || !touchLook || e.pointerId !== touchLook.id) return;
      const dx = e.clientX - touchLook.x, dy = e.clientY - touchLook.y;
      touchLook.x = e.clientX;
      touchLook.y = e.clientY;
      state.heading = C.Math.zeroToTwoPi(state.heading + dx * 0.006);
      state.pitch = C.Math.clamp(state.pitch - dy * 0.0045, C.Math.toRadians(-45), C.Math.toRadians(35));
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
    const endTouchLook = (e) => { if (touchLook && e.pointerId === touchLook.id) touchLook = null; };
    viewer.canvas.addEventListener('pointerup', endTouchLook, true);
    viewer.canvas.addEventListener('pointercancel', endTouchLook, true);

    window.MatsuyamaWalk = { start, stop, toggleView, state };
  }
})();
