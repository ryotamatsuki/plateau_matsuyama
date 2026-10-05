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
      avatar:null, avatarModel:null, avatarLoad:null, avatarReady:false, avatarError:null,
      avatarAnimation:'idle', avatarAnimationIndex:0, avatarAnimationNames:[], avatarAnimationMap:{}, avatarActiveName:null,
      avatarUrl:'https://raw.githubusercontent.com/mrdoob/three.js/eba30de865cfbf31ac736f792defd9a60ff28d57/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
      mobileProfile:null, mobileProfileActive:false,
      shadow:null, line:null, timer:0, blockedUntil:0, lastSpeedText:'',
      rafId:0, loopLast:0, loopStartedAt:0, loopFrames:0, loopSteps:0,
      loopFps:0, loopFrameMs:0, loopMaxFrameMs:0,
      lastCollision:-Infinity, collisionInterval:1000/30, collisionBlocked:false, collisionChecks:0,
      colliderUrl:'walk-colliders-stage1.json', colliderLoad:null, collider:null, colliderReady:false, colliderError:null,
      colliderRadius:0.38, colliderChecks:0, colliderHits:0, rayFallbackChecks:0,
      terrainCachedHits:0, terrainAsyncRefines:0, terrainWarmLast:0,
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


    function colliderCellKey(lon, lat, size) {
      return `${Math.floor(lon / size)},${Math.floor(lat / size)}`;
    }

    async function loadLocalColliders() {
      if (state.colliderReady) return state.collider;
      if (state.colliderLoad) return state.colliderLoad;
      state.colliderLoad = (async () => {
        try {
          const response = await fetch(state.colliderUrl, { cache:'force-cache' });
          if (!response.ok) throw new Error(`${state.colliderUrl} ${response.status}`);
          const raw = await response.json();
          const cellSize = Number(raw.cellSizeDegrees || .001);
          const cells = new Map();
          const buildings = [];
          for (const row of raw.buildings || []) {
            if (!Array.isArray(row) || row.length < 4) continue;
            const west=Number(row[0]), south=Number(row[1]), east=Number(row[2]), north=Number(row[3]);
            if (![west,south,east,north].every(Number.isFinite)) continue;
            const item={west,south,east,north,id:String(row[4]||'')};
            const index=buildings.push(item)-1;
            const ix0=Math.floor(west/cellSize), ix1=Math.floor(east/cellSize);
            const iy0=Math.floor(south/cellSize), iy1=Math.floor(north/cellSize);
            for(let ix=ix0;ix<=ix1;ix++) for(let iy=iy0;iy<=iy1;iy++){
              const key=`${ix},${iy}`;
              let bucket=cells.get(key);
              if(!bucket) cells.set(key,bucket=[]);
              bucket.push(index);
            }
          }
          state.collider={
            bbox:(raw.bbox||[]).map(Number),
            cellSize,
            buildings,
            cells,
            source:String(raw.source||'')
          };
          state.colliderReady=state.collider.bbox.length===4 && buildings.length>0;
          state.colliderError=null;
          return state.collider;
        } catch (error) {
          state.colliderError=String(error?.message||error);
          state.colliderReady=false;
          return null;
        } finally {
          state.colliderLoad=null;
        }
      })();
      return state.colliderLoad;
    }

    function withinColliderCoverage(lon,lat) {
      const b=state.collider?.bbox;
      return !!(state.colliderReady && b && lon>=b[0] && lon<=b[2] && lat>=b[1] && lat<=b[3]);
    }

    function localColliderBlocked(lon,lat) {
      if (!withinColliderCoverage(lon,lat)) return null;
      const index=state.collider;
      state.colliderChecks++;
      const latScale=111320;
      const lonScale=latScale*Math.max(.2,Math.cos(C.Math.toRadians(lat)));
      const r=state.colliderRadius;
      const cx=Math.floor(lon/index.cellSize), cy=Math.floor(lat/index.cellSize);
      const seen=new Set();
      for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){
        const bucket=index.cells.get(`${cx+dx},${cy+dy}`);
        if(!bucket) continue;
        for(const bi of bucket){
          if(seen.has(bi)) continue;
          seen.add(bi);
          const b=index.buildings[bi];
          const nx=Math.max(b.west,Math.min(lon,b.east));
          const ny=Math.max(b.south,Math.min(lat,b.north));
          const mx=(lon-nx)*lonScale, my=(lat-ny)*latScale;
          if(mx*mx+my*my < r*r){
            state.colliderHits++;
            state.blockedUntil=performance.now()+120;
            return true;
          }
        }
      }
      return false;
    }

    function warmTerrainCache() {
      const api=window.MatsuyamaTerrain;
      const now=performance.now();
      if(!api?.warmHeightCache || now-state.terrainWarmLast<1800) return;
      state.terrainWarmLast=now;
      api.warmHeightCache(state.lon,state.lat,90).then(()=>{
        if(state.active) {
          const h=api.sampleEllipsoidHeightCached?.(state.lon,state.lat);
          if(plausibleTerrainHeight(h)) {
            state.ground=h;
            updateAvatar();
            cameraPose();
          }
        }
      }).catch(()=>{});
    }

    function avatarModelMatrix() {
      const p = pos(.03);
      // Cesium Man's authored forward axis is aligned to the local frame with a 180° correction.
      const hpr = new C.HeadingPitchRoll(C.Math.zeroToTwoPi(state.heading + Math.PI), 0, 0);
      return C.Transforms.headingPitchRollToFixedFrame(p, hpr);
    }

    function animationIndexFor(mode) {
      const map=state.avatarAnimationMap||{};
      return Number.isInteger(map[mode]) ? map[mode] : state.avatarAnimationIndex;
    }

    function playAvatarAnimation(mode='idle') {
      const model = state.avatarModel;
      if (state.avatarAnimation === mode && state.avatarReady && model?.activeAnimations?.length === 1) return;
      state.avatarAnimation = mode;
      if (!state.avatarReady || !model?.ready || !model.activeAnimations) return;
      model.activeAnimations.removeAll();
      try {
        const runtime=model.activeAnimations.add({
          index:animationIndexFor(mode),
          loop:C.ModelAnimationLoop.REPEAT,
          multiplier:1.0
        });
        state.avatarActiveName=runtime?.name||state.avatarAnimationNames[animationIndexFor(mode)]||null;
        state.avatarError=null;
      } catch (error) {
        state.avatarActiveName=null;
        state.avatarError = String(error?.message || error);
      }
    }

    function waitForAvatarModelReady(model) {
      if (model?.ready) return Promise.resolve(model);
      return new Promise((resolve,reject) => {
        let settled=false;
        let offReady=null;
        let offError=null;
        const timeout=setTimeout(() => finish(new Error('Avatar model ready timeout')),30000);
        function finish(error) {
          if (settled) return;
          settled=true;
          clearTimeout(timeout);
          if (typeof offReady === 'function') offReady();
          if (typeof offError === 'function') offError();
          if (error) reject(error); else resolve(model);
        }
        offReady=model?.readyEvent?.addEventListener?.(() => finish());
        offError=model?.errorEvent?.addEventListener?.((error) => finish(error instanceof Error ? error : new Error(String(error?.message||error))));
        viewer.scene.requestRender();
      });
    }

    async function loadAvatarModel() {
      if (state.avatarReady || state.avatarLoad) return state.avatarLoad;
      state.avatarLoad = (async() => {
        try {
          let animationNames=[];
          const model = await C.Model.fromGltfAsync({
            url:state.avatarUrl,
            modelMatrix:avatarModelMatrix(),
            scale:1,
            minimumPixelSize:28,
            maximumScale:1.0,
            allowPicking:false,
            shadows:C.ShadowMode.DISABLED,
            incrementallyLoadTextures:true,
            gltfCallback:(gltf)=>{animationNames=(gltf.animations||[]).map((a,i)=>a.name||`animation-${i}`);}
          });
          state.avatarModel = viewer.scene.primitives.add(model);
          state.avatarAnimationNames = animationNames;
          const find=(re)=>animationNames.findIndex((n)=>re.test(n));
          state.avatarAnimationMap={
            idle:Math.max(0,find(/^idle$/i)),
            walk:Math.max(0,find(/^walking$|^walk$/i)),
            run:Math.max(0,find(/^running$|^run$/i))
          };
          state.avatarAnimationIndex=state.avatarAnimationMap.walk;
          state.avatarReady = false;
          state.avatarActiveName = null;
          state.avatarError = null;
          state.avatarModel.show = state.active && state.view === 'third';
          if (state.avatar) state.avatar.show = state.active && state.view === 'third';
          viewer.scene.requestRender();
          await waitForAvatarModelReady(model);
          state.avatarReady = true;
          state.avatarModel.show = state.active && state.view === 'third';
          if (state.avatar) state.avatar.show = false;
          const desired=state.avatarAnimation;
          state.avatarAnimation='';
          playAvatarAnimation(desired);
          updateAvatar();
          viewer.scene.requestRender();
          return model;
        } catch (error) {
          state.avatarError = String(error?.message || error);
          state.avatarReady = false;
          if (state.avatar) state.avatar.show = state.active && state.view === 'third';
          return null;
        } finally {
          state.avatarLoad = null;
        }
      })();
      return state.avatarLoad;
    }

    function ensureAvatar() {
      if (!state.shadow) state.shadow = viewer.entities.add({position:pos(.04),ellipse:{semiMajorAxis:.42,semiMinorAxis:.24,material:C.Color.BLACK.withAlpha(.28)}});
      if (!state.line) state.line = viewer.entities.add({polyline:{positions:[pos(.08),pos(.08)],width:3,material:C.Color.CYAN.withAlpha(.8)}});
      if (!state.avatar) state.avatar = viewer.entities.add({position:pos(.92),billboard:{image:avatarSvg,width:48,height:90,verticalOrigin:C.VerticalOrigin.BOTTOM,disableDepthTestDistance:250,scaleByDistance:new C.NearFarScalar(5,1.15,80,.7)}});
      loadAvatarModel();
    }

    function updateAvatar() {
      if (!state.avatar) return;
      const show = state.active && state.view === 'third';
      state.avatar.show = show && !state.avatarReady;
      if (state.avatarModel) {
        state.avatarModel.show = show;
        state.avatarModel.modelMatrix = avatarModelMatrix();
      }
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

    function plausibleTerrainHeight(h) {
      return Number.isFinite(h) && h > -500 && h < 3000;
    }

    function globeHeight(lon, lat) {
      try {
        const h = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
        return plausibleTerrainHeight(h) ? h : null;
      } catch (_) { return null; }
    }

    async function authoritativeTerrainHeight(lon, lat) {
      const sampler = window.MatsuyamaTerrain && window.MatsuyamaTerrain.sampleEllipsoidHeight;
      if (typeof sampler === 'function') {
        try {
          const h = await sampler(lon, lat);
          if (plausibleTerrainHeight(h)) return h;
        } catch (_) {}
      }
      return globeHeight(lon, lat);
    }

    async function refineTerrain() {
      if (!state.active) return;
      const now = performance.now();
      if (now - state.lastTerrain < 500) return;
      state.lastTerrain = now;
      state.terrainAsyncRefines++;
      const h = await authoritativeTerrainHeight(state.lon, state.lat);
      if (!state.active) return;
      if (h !== null) {
        state.ground = h;
        if(groundEl.textContent!=='地形追従')groundEl.textContent = '地形追従';
        updateAvatar(); cameraPose();
        warmTerrainCache();
      } else {
        groundEl.textContent = '地形読込中';
      }
    }

    function blocked(worldDir, step, now=performance.now()) {
      state.rayFallbackChecks++;
      if (typeof viewer.scene.pickFromRay !== 'function' || step < .02) {
        state.collisionBlocked = false;
        return false;
      }
      if (now - state.lastCollision < state.collisionInterval) return state.collisionBlocked;
      state.lastCollision = now;
      state.collisionChecks++;
      let isBlocked = false;
      try {
        const origin = pos(.9);
        const ray = new C.Ray(origin, C.Cartesian3.normalize(worldDir, new C.Cartesian3()));
        const hit = viewer.scene.pickFromRay(ray);
        if (hit && hit.position && (!hit.object || hit.object instanceof C.Cesium3DTileFeature)) {
          isBlocked = C.Cartesian3.distance(origin, hit.position) < Math.max(.85, step + .55);
        }
      } catch (_) {}
      state.collisionBlocked = isBlocked;
      if (isBlocked) state.blockedUntil = now + 450;
      return isBlocked;
    }

    function offsetLonLat(east,north,baseLon=state.lon,baseLat=state.lat) {
      const R=6378137, latr=C.Math.toRadians(baseLat);
      return {
        lat:baseLat+C.Math.toDegrees(north/R),
        lon:baseLon+C.Math.toDegrees(east/(R*Math.max(.15,Math.cos(latr))))
      };
    }

    function applyMove(lon,lat) {
      if (lon < 132.45 || lon > 132.97 || lat < 33.65 || lat > 34.13) return false;
      state.lon=lon;
      state.lat=lat;
      const cached=window.MatsuyamaTerrain?.sampleEllipsoidHeightCached?.(lon,lat);
      if (plausibleTerrainHeight(cached)) {
        // The cached value comes from the same pinned GSI DEM/geoid authority as
        // the async sampler, so it is safe to use directly in the movement hot path.
        state.ground=cached;
        state.terrainCachedHits++;
      } else {
        const h=globeHeight(lon,lat);
        if (h !== null && Math.abs(h-state.ground)<4.5) state.ground=h;
      }
      refineTerrain();
      warmTerrainCache();
      return true;
    }

    function moveWithLocalCollision(east,north) {
      const full=offsetLonLat(east,north);
      const blockedFull=localColliderBlocked(full.lon,full.lat);
      if (blockedFull === null) return null;
      if (!blockedFull) return applyMove(full.lon,full.lat);
      // Axis-separated fallback gives wall sliding rather than a hard stop.
      if (Math.abs(east)>1e-6) {
        const x=offsetLonLat(east,0);
        if (!localColliderBlocked(x.lon,x.lat) && applyMove(x.lon,x.lat)) return true;
      }
      if (Math.abs(north)>1e-6) {
        const y=offsetLonLat(0,north);
        if (!localColliderBlocked(y.lon,y.lat) && applyMove(y.lon,y.lat)) return true;
      }
      return false;
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

    function stepControls(dt = 1 / 60, now=performance.now()) {
      if (!state.active) return;
      dt = C.Math.clamp(Number(dt) || 0, 0, 1 / 30);
      state.loopSteps++;
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
        const fast = state.keys.has('ShiftLeft') || state.keys.has('ShiftRight') || (!keyboardActive && analogMagnitude > .82);
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
        if (state.view === 'third' && Math.hypot(e, n) > 1e-6) {
          state.heading = C.Math.zeroToTwoPi(Math.atan2(e, n));
          avatarChanged=true;
        }
        playAvatarAnimation(fast ? 'run' : 'walk');
        setSpeedText(`${fast ? '走行' : '歩行'} ${speed.toFixed(1)} m/s`);
        const localMove=moveWithLocalCollision(e,n);
        if (localMove === true) {
          poseChanged=true; avatarChanged=true;
        } else if (localMove === null && !blocked(wd,dist,now)) {
          const target=offsetLonLat(e,n);
          if(applyMove(target.lon,target.lat)){poseChanged=true;avatarChanged=true;}
        }
      } else {
        playAvatarAnimation('idle');
        setSpeedText('停止');
      }

      if (now < state.blockedUntil) setSpeedText('建物前で停止');
      if (avatarChanged) updateAvatar();
      if (poseChanged) cameraPose();
    }

    function gameFrame(now) {
      if (!state.active) {
        state.rafId = 0;
        return;
      }
      const previous = state.loopLast || (now - 1000 / 60);
      const frameMs = Math.max(0, now - previous);
      state.loopLast = now;
      state.lastTick = now;
      state.loopFrames++;
      if (frameMs > 0) {
        const fps = 1000 / frameMs;
        state.loopFps = state.loopFps ? state.loopFps * .9 + fps * .1 : fps;
        state.loopFrameMs = state.loopFrameMs ? state.loopFrameMs * .9 + frameMs * .1 : frameMs;
        state.loopMaxFrameMs = Math.max(state.loopMaxFrameMs, frameMs);
      }
      stepControls(Math.min(1 / 30, frameMs / 1000), now);
      state.rafId = requestAnimationFrame(gameFrame);
    }

    function startGameLoop() {
      if (!state.active || state.rafId) return;
      const now = performance.now();
      state.loopStartedAt = now;
      state.loopLast = 0;
      state.lastTick = now;
      state.loopFrames = 0;
      state.loopSteps = 0;
      state.loopFps = 0;
      state.loopFrameMs = 0;
      state.loopMaxFrameMs = 0;
      state.lastCollision = -Infinity;
      state.collisionBlocked = false;
      state.collisionChecks = 0;
      state.colliderChecks = 0;
      state.colliderHits = 0;
      state.rayFallbackChecks = 0;
      state.terrainCachedHits = 0;
      state.terrainAsyncRefines = 0;
      state.timer = 0;
      state.rafId = requestAnimationFrame(gameFrame);
    }

    function stopGameLoop() {
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = 0;
      state.loopLast = 0;
      state.timer = 0;
    }

    function mobileWalkProfile(on) {
      const mobile=matchMedia('(pointer:coarse)').matches || innerWidth<=700;
      if(!mobile) return;
      const scene=viewer.scene;
      if(on && !state.mobileProfileActive){
        const stage1=window.MatsuyamaProceduralStage1;
        const tiles=[];
        for(let i=0;i<scene.primitives.length;i++){
          const p=scene.primitives.get(i);
          if(p instanceof C.Cesium3DTileset) tiles.push({p,sse:p.maximumScreenSpaceError});
        }
        state.mobileProfile={resolutionScale:viewer.resolutionScale,shadows:viewer.shadows,
          ao:scene.postProcessStages.ambientOcclusion.enabled,stage1Enabled:stage1?.state?.enabled,tiles};
        viewer.resolutionScale=Math.min(viewer.resolutionScale||1,0.72);
        viewer.shadows=false;
        scene.postProcessStages.ambientOcclusion.enabled=false;
        for(const t of tiles)t.p.maximumScreenSpaceError=Math.max(t.sse||12,24);
        if(stage1?.setEnabled) stage1.setEnabled(false);
        state.mobileProfileActive=true;
        scene.requestRender();
      } else if(!on && state.mobileProfileActive){
        const p=state.mobileProfile;
        viewer.resolutionScale=p.resolutionScale; viewer.shadows=p.shadows;
        scene.postProcessStages.ambientOcclusion.enabled=p.ao;
        for(const t of p.tiles||[]) if(t.p&&!t.p.isDestroyed?.())t.p.maximumScreenSpaceError=t.sse;
        if(p.stage1Enabled && window.MatsuyamaProceduralStage1?.setEnabled) window.MatsuyamaProceduralStage1.setEnabled(true);
        state.mobileProfile=null; state.mobileProfileActive=false; scene.requestRender();
      }
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
      mobileWalkProfile(true);
      loadLocalColliders();
      warmTerrainCache();
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
      if (plausibleTerrainHeight(h)) state.ground = h;
      setView('third');
      refineTerrain();
      startGameLoop();
      stepControls(0, performance.now());
      window.dispatchEvent(new CustomEvent('matsuyama-walk-active',{detail:true}));
    }

    function stop() {
      if (!state.active) return;
      state.active = false;
      state.keys.clear();
      resetAnalog();
      stopGameLoop();
      if (document.pointerLockElement === viewer.canvas) document.exitPointerLock?.();
      viewer.scene.screenSpaceCameraController.enableInputs = state.oldInputs;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = state.oldCollision;
      document.body.classList.remove('walk-mode-active');
      mobileWalkProfile(false);
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

    function debug() {
      return {
        active:state.active,
        view:state.view,
        scheduler:'requestAnimationFrame',
        avatar:{
          renderer:state.avatarReady?'glb-model':'billboard-fallback',
          ready:state.avatarReady,
          url:state.avatarUrl,
          animations:[...state.avatarAnimationNames],
          animationMap:{...state.avatarAnimationMap},
          state:state.avatarAnimation,
          activeName:state.avatarActiveName,
          activeCount:state.avatarModel?.activeAnimations?.length||0,
          modelReady:!!state.avatarModel?.ready,
          error:state.avatarError,
          modelVisible:!!state.avatarModel?.show,
          fallbackVisible:!!state.avatar?.show
        },
        loop:{
          rafActive:!!state.rafId,
          frameCount:state.loopFrames,
          stepCount:state.loopSteps,
          fps:Number(state.loopFps.toFixed(2)),
          frameMs:Number(state.loopFrameMs.toFixed(2)),
          maxFrameMs:Number(state.loopMaxFrameMs.toFixed(2)),
          collisionChecks:state.collisionChecks,
          collisionIntervalMs:Number(state.collisionInterval.toFixed(2)),
          localColliderChecks:state.colliderChecks,
          localColliderHits:state.colliderHits,
          rayFallbackChecks:state.rayFallbackChecks,
          terrainCachedHits:state.terrainCachedHits,
          terrainAsyncRefines:state.terrainAsyncRefines
        },
        collision:{
          mode:state.colliderReady?'local-cpu+bounds-fallback':'ray-fallback',
          ready:state.colliderReady,
          count:state.collider?.buildings?.length||0,
          radiusMeters:state.colliderRadius,
          coverage:state.collider?.bbox||null,
          error:state.colliderError
        },
        performance:{mobileProfileActive:state.mobileProfileActive,resolutionScale:viewer.resolutionScale,shadows:!!viewer.shadows,ambientOcclusion:!!viewer.scene.postProcessStages.ambientOcclusion.enabled},
        terrain:{
          cachedSampler:typeof window.MatsuyamaTerrain?.sampleEllipsoidHeightCached==='function',
          warmCache:typeof window.MatsuyamaTerrain?.warmHeightCache==='function'
        }
      };
    }

    document.addEventListener('visibilitychange', () => {
      if (!state.active) return;
      if (document.hidden) stopGameLoop();
      else startGameLoop();
    });

    window.MatsuyamaWalk = {
      start, stop, toggleView, setView, setVirtualStick, stepControls, startGameLoop, stopGameLoop, debug, state,
      debugCollisionAt:(lon,lat)=>localColliderBlocked(Number(lon),Number(lat)),
      debugTerrainAt:(lon,lat)=>window.MatsuyamaTerrain?.sampleEllipsoidHeightCached?.(Number(lon),Number(lat)) ?? null
    };
  }
})();
