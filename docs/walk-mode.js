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

  // Capture the Viewer instance without replacing Cesium.Viewer itself.
  // Cesium Viewer calls render/resize during startup, so wrapping prototype
  // methods is compatible with read-only global module exports.
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
      #walkToggle{position:absolute;left:375px;top:18px;z-index:9;min-height:44px;padding:9px 14px;border:1px solid #70d7e8;border-radius:8px;background:#123950ee;color:#f2fbff;font:600 14px system-ui;box-shadow:0 8px 24px #0006;cursor:pointer}
      #walkToggle:hover,#walkToggle.active{background:#1f6683}
      #walkHud{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);z-index:9;min-width:min(560px,calc(100% - 32px));padding:10px 13px;border:1px solid #55748d;border-radius:10px;background:#0e2032e8;color:#eef7fb;box-shadow:0 10px 28px #0007;font:13px/1.45 system-ui;backdrop-filter:blur(5px)}
      #walkHud[hidden],#walkCrosshair[hidden],#walkTouch[hidden]{display:none!important}.walk-head{display:flex;gap:10px;justify-content:space-between;align-items:center}.walk-badges{display:flex;gap:6px;flex-wrap:wrap}.walk-badges span{padding:3px 7px;border-radius:999px;background:#173c55;border:1px solid #45667d;color:#cdeef5;font-size:11px}.walk-help{margin-top:6px;color:#c4d1dc;font-size:11.5px}.walk-help kbd{display:inline-block;padding:2px 5px;border:1px solid #65788b;border-bottom-width:2px;border-radius:4px;background:#172a3b;color:#fff;font:11px system-ui}
      #walkCrosshair{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%);z-index:9;pointer-events:none}#walkCrosshair:before,#walkCrosshair:after{content:"";position:absolute;background:#fff;box-shadow:0 0 3px #000}#walkCrosshair:before{left:8px;top:2px;width:2px;height:14px}#walkCrosshair:after{top:8px;left:2px;width:14px;height:2px}
      #walkTouch{position:absolute;inset:0;z-index:9;pointer-events:none}.walk-pad{position:absolute;bottom:18px;display:grid;gap:6px;pointer-events:auto}.walk-pad.left{left:12px;grid-template-columns:repeat(3,52px);grid-template-rows:repeat(2,52px)}.walk-pad.right{right:12px;grid-template-columns:repeat(2,58px);grid-template-rows:repeat(2,52px)}.walk-pad button{min-height:52px;border:1px solid #8cb4c7;border-radius:12px;background:#12344ed9;color:#fff;font-size:20px;touch-action:none}.forward{grid-column:2}.leftward{grid-column:1;grid-row:2}.back{grid-column:2;grid-row:2}.rightward{grid-column:3;grid-row:2}.walk-pad.right .smallbtn{font-size:12px}
      @media(pointer:fine){#walkTouch{display:none!important}}@media(max-width:700px){#walkToggle{top:8px;right:8px;left:auto;min-height:40px;padding:7px 10px;font-size:12px}#walkHud{bottom:138px;min-width:calc(100% - 20px);padding:8px 10px}.walk-help{display:none}.mapbadge{display:none}}
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
    hud.innerHTML = `<div class="walk-head"><strong>防災ウォーク</strong><div class="walk-badges"><span id="walkView">三人称</span><span id="walkSpeed">停止</span><span id="walkGround">地形追従</span></div></div><div class="walk-help"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移動　<kbd>←</kbd><kbd>→</kbd> 回転　<kbd>↑</kbd><kbd>↓</kbd> 視線　<kbd>V</kbd> 一/三人称　<kbd>Shift</kbd> 早歩き　<kbd>Esc</kbd> 終了</div>`;
    main.appendChild(hud);

    const crosshair = document.createElement('div');
    crosshair.id = 'walkCrosshair'; crosshair.hidden = true; main.appendChild(crosshair);
    const touch = document.createElement('div');
    touch.id = 'walkTouch'; touch.hidden = true;
    touch.innerHTML = `<div class="walk-pad left"><button class="forward" data-key="KeyW">▲</button><button class="leftward" data-key="KeyA">◀</button><button class="back" data-key="KeyS">▼</button><button class="rightward" data-key="KeyD">▶</button></div><div class="walk-pad right"><button data-key="ArrowLeft">↶</button><button data-key="ArrowRight">↷</button><button id="walkViewBtn" class="smallbtn">一/三人称</button><button id="walkExitBtn" class="smallbtn">終了</button></div>`;
    main.appendChild(touch);

    const state = {
      active:false, view:'third', lon:132.7657, lat:33.8392, ground:60,
      heading:C.Math.toRadians(15), pitch:C.Math.toRadians(-4), eye:1.67,
      speed:2.2, fast:4.2, keys:new Set(), last:0, lastTerrain:0,
      avatar:null, shadow:null, line:null, raf:0, blockedUntil:0,
      oldInputs:true, oldCollision:true
    };
    const viewEl = hud.querySelector('#walkView');
    const speedEl = hud.querySelector('#walkSpeed');
    const groundEl = hud.querySelector('#walkGround');

    const avatarSvg = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="180" viewBox="0 0 96 180"><ellipse cx="48" cy="24" rx="17" ry="18" fill="#f1c8a8" stroke="#15384c" stroke-width="4"/><path d="M28 48Q48 38 68 48L73 103Q50 116 23 103Z" fill="#2b7ea1" stroke="#15384c" stroke-width="5"/><path d="M25 58L7 94M70 58L89 93" stroke="#f1c8a8" stroke-width="12" stroke-linecap="round"/><path d="M37 105L29 163M59 105L68 163" stroke="#293747" stroke-width="16" stroke-linecap="round"/><path d="M19 169H40M59 169H81" stroke="#17222c" stroke-width="10" stroke-linecap="round"/></svg>`);

    function pos(offset=0){return C.Cartesian3.fromDegrees(state.lon,state.lat,state.ground+offset);}
    function axes(offset=0){const origin=pos(offset),m=C.Transforms.eastNorthUpToFixedFrame(origin);const col=(i)=>{const v=C.Matrix4.getColumn(m,i,new C.Cartesian4());return new C.Cartesian3(v.x,v.y,v.z);};return{origin,east:col(0),north:col(1),up:col(2)};}
    function basis(){const a=axes(state.eye),s=Math.sin(state.heading),c=Math.cos(state.heading);const forward=C.Cartesian3.normalize(C.Cartesian3.add(C.Cartesian3.multiplyByScalar(a.north,c,new C.Cartesian3()),C.Cartesian3.multiplyByScalar(a.east,s,new C.Cartesian3()),new C.Cartesian3()),new C.Cartesian3());const right=C.Cartesian3.normalize(C.Cartesian3.add(C.Cartesian3.multiplyByScalar(a.east,c,new C.Cartesian3()),C.Cartesian3.multiplyByScalar(a.north,-s,new C.Cartesian3()),new C.Cartesian3()),new C.Cartesian3());return{...a,forward,right};}

    function ensureAvatar(){if(state.avatar)return;state.shadow=viewer.entities.add({position:pos(.04),ellipse:{semiMajorAxis:.42,semiMinorAxis:.24,material:C.Color.BLACK.withAlpha(.35)}});state.line=viewer.entities.add({polyline:{positions:[pos(.08),pos(.08)],width:3,material:C.Color.CYAN.withAlpha(.8)}});state.avatar=viewer.entities.add({position:pos(.92),billboard:{image:avatarSvg,width:48,height:90,verticalOrigin:C.VerticalOrigin.BOTTOM,disableDepthTestDistance:250,scaleByDistance:new C.NearFarScalar(5,1.15,80,.7)}});}
    function updateAvatar(){if(!state.avatar)return;const show=state.active&&state.view==='third';state.avatar.show=show;state.shadow.show=show;state.line.show=show;state.avatar.position=pos(.92);state.shadow.position=pos(.04);const b=basis(),tip=C.Cartesian3.add(pos(.08),C.Cartesian3.multiplyByScalar(b.forward,2,new C.Cartesian3()),new C.Cartesian3());state.line.polyline.positions=[pos(.08),tip];}

    function cameraPose(){const b=basis(),cp=Math.cos(state.pitch),sp=Math.sin(state.pitch);const dir=C.Cartesian3.normalize(C.Cartesian3.add(C.Cartesian3.multiplyByScalar(b.forward,cp,new C.Cartesian3()),C.Cartesian3.multiplyByScalar(b.up,sp,new C.Cartesian3()),new C.Cartesian3()),new C.Cartesian3());if(state.view==='first'){const up=C.Cartesian3.normalize(C.Cartesian3.cross(b.right,dir,new C.Cartesian3()),new C.Cartesian3());viewer.camera.setView({destination:b.origin,orientation:{direction:dir,up}});}else{const target=C.Cartesian3.add(pos(1.25),C.Cartesian3.multiplyByScalar(b.forward,1.2,new C.Cartesian3()),new C.Cartesian3());let cam=C.Cartesian3.subtract(target,C.Cartesian3.multiplyByScalar(b.forward,7.5,new C.Cartesian3()),new C.Cartesian3());cam=C.Cartesian3.add(cam,C.Cartesian3.multiplyByScalar(b.up,3.8,new C.Cartesian3()),cam);const look=C.Cartesian3.normalize(C.Cartesian3.subtract(target,cam,new C.Cartesian3()),new C.Cartesian3()),up=C.Cartesian3.normalize(C.Cartesian3.cross(b.right,look,new C.Cartesian3()),new C.Cartesian3());viewer.camera.setView({destination:cam,orientation:{direction:look,up}});}viewer.scene.requestRender();}

    function globeHeight(lon,lat){try{const h=viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(lon,lat));return Number.isFinite(h)?h:null;}catch(_){return null;}}
    async function refineTerrain(){if(!state.active)return;const now=performance.now();if(now-state.lastTerrain<500)return;state.lastTerrain=now;try{const r=await C.sampleTerrainMostDetailed(viewer.terrainProvider,[C.Cartographic.fromDegrees(state.lon,state.lat)]);if(state.active&&r[0]&&Number.isFinite(r[0].height)){state.ground=r[0].height;groundEl.textContent='地形追従';updateAvatar();}}catch(_){const h=globeHeight(state.lon,state.lat);if(h!==null)state.ground=h;else groundEl.textContent='地形読込中';}}

    function blocked(worldDir,step){if(typeof viewer.scene.pickFromRay!=='function'||step<.02)return false;try{const origin=pos(.9),ray=new C.Ray(origin,C.Cartesian3.normalize(worldDir,new C.Cartesian3())),hit=viewer.scene.pickFromRay(ray);if(!hit||!hit.position)return false;if(hit.object&&!(hit.object instanceof C.Cesium3DTileFeature))return false;if(C.Cartesian3.distance(origin,hit.position)<Math.max(.85,step+.55)){state.blockedUntil=performance.now()+450;return true;}}catch(_){}return false;}
    function move(east,north){const R=6378137,latr=C.Math.toRadians(state.lat),lat=state.lat+C.Math.toDegrees(north/R),lon=state.lon+C.Math.toDegrees(east/(R*Math.max(.15,Math.cos(latr))));if(lon<132.45||lon>132.97||lat<33.65||lat>34.13)return;state.lon=lon;state.lat=lat;const h=globeHeight(lon,lat);if(h!==null&&Math.abs(h-state.ground)<4.5)state.ground=h;updateAvatar();refineTerrain();}

    function frame(t){if(!state.active)return;const dt=state.last?Math.min(.05,(t-state.last)/1000):0;state.last=t;const turn=C.Math.toRadians(80),look=C.Math.toRadians(55);if(state.keys.has('ArrowLeft'))state.heading-=turn*dt;if(state.keys.has('ArrowRight'))state.heading+=turn*dt;if(state.keys.has('ArrowUp'))state.pitch=Math.min(C.Math.toRadians(35),state.pitch+look*dt);if(state.keys.has('ArrowDown'))state.pitch=Math.max(C.Math.toRadians(-45),state.pitch-look*dt);state.heading=C.Math.zeroToTwoPi(state.heading);let f=(state.keys.has('KeyW')?1:0)-(state.keys.has('KeyS')?1:0),r=(state.keys.has('KeyD')?1:0)-(state.keys.has('KeyA')?1:0);if(f||r){const mag=Math.hypot(f,r);f/=mag;r/=mag;const fast=state.keys.has('ShiftLeft')||state.keys.has('ShiftRight'),speed=fast?state.fast:state.speed,dist=speed*dt,e=Math.sin(state.heading)*f*dist+Math.cos(state.heading)*r*dist,n=Math.cos(state.heading)*f*dist-Math.sin(state.heading)*r*dist,b=basis(),wd=C.Cartesian3.add(C.Cartesian3.multiplyByScalar(b.east,e,new C.Cartesian3()),C.Cartesian3.multiplyByScalar(b.north,n,new C.Cartesian3()),new C.Cartesian3());speedEl.textContent=`${fast?'早歩き':'歩行'} ${speed.toFixed(1)} m/s`;if(!blocked(wd,dist))move(e,n);}else speedEl.textContent='停止';if(performance.now()<state.blockedUntil)speedEl.textContent='建物前で停止';updateAvatar();cameraPose();state.raf=requestAnimationFrame(frame);}

    function setView(mode){state.view=mode;viewEl.textContent=mode==='first'?'一人称':'三人称';crosshair.hidden=!state.active||mode!=='first';updateAvatar();cameraPose();}
    function toggleView(){setView(state.view==='first'?'third':'first');}
    function start(){if(state.active)return;state.active=true;ensureAvatar();state.oldInputs=viewer.scene.screenSpaceCameraController.enableInputs;state.oldCollision=viewer.scene.screenSpaceCameraController.enableCollisionDetection;viewer.scene.screenSpaceCameraController.enableInputs=false;viewer.scene.screenSpaceCameraController.enableCollisionDetection=true;const card=document.getElementById('feature');if(card)card.hidden=true;toggle.classList.add('active');toggle.textContent='■ ウォーク終了';hud.hidden=false;touch.hidden=false;state.last=0;const h=globeHeight(state.lon,state.lat);if(h!==null)state.ground=h;setView('third');refineTerrain();state.raf=requestAnimationFrame(frame);}
    function stop(){if(!state.active)return;state.active=false;state.keys.clear();cancelAnimationFrame(state.raf);if(document.pointerLockElement===viewer.canvas)document.exitPointerLock?.();viewer.scene.screenSpaceCameraController.enableInputs=state.oldInputs;viewer.scene.screenSpaceCameraController.enableCollisionDetection=state.oldCollision;toggle.classList.remove('active');toggle.textContent='🚶 防災ウォーク';hud.hidden=true;touch.hidden=true;crosshair.hidden=true;updateAvatar();viewer.scene.requestRender();}

    toggle.onclick=()=>state.active?stop():start();
    touch.querySelector('#walkViewBtn').onclick=toggleView;touch.querySelector('#walkExitBtn').onclick=stop;
    const captured=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','ShiftLeft','ShiftRight']);
    window.addEventListener('keydown',(e)=>{if(!state.active)return;if(e.code==='Escape'){stop();return;}if(e.code==='KeyV'){e.preventDefault();toggleView();return;}if(captured.has(e.code)){e.preventDefault();state.keys.add(e.code);}},{passive:false});
    window.addEventListener('keyup',(e)=>state.keys.delete(e.code));window.addEventListener('blur',()=>state.keys.clear());
    touch.querySelectorAll('[data-key]').forEach((b)=>{const key=b.dataset.key;b.addEventListener('pointerdown',(e)=>{e.preventDefault();state.keys.add(key);b.setPointerCapture?.(e.pointerId);},{passive:false});for(const type of ['pointerup','pointercancel','pointerleave'])b.addEventListener(type,(e)=>{if(type!=='pointerleave'||e.buttons===0)state.keys.delete(key);});});

    viewer.canvas.addEventListener('click',(e)=>{if(!state.active)return;e.preventDefault();e.stopImmediatePropagation();if(state.view==='first'&&matchMedia('(pointer:fine)').matches&&document.pointerLockElement!==viewer.canvas)viewer.canvas.requestPointerLock?.();},true);
    for(const type of ['mousedown','mouseup','dblclick'])viewer.canvas.addEventListener(type,(e)=>{if(state.active){e.preventDefault();e.stopImmediatePropagation();}},true);
    document.addEventListener('mousemove',(e)=>{if(!state.active||state.view!=='first'||document.pointerLockElement!==viewer.canvas)return;state.heading=C.Math.zeroToTwoPi(state.heading+e.movementX*.0024);state.pitch=C.Math.clamp(state.pitch-e.movementY*.0019,C.Math.toRadians(-45),C.Math.toRadians(35));});
    let touchLook=null;viewer.canvas.addEventListener('pointerdown',(e)=>{if(state.active&&e.pointerType==='touch'){touchLook={id:e.pointerId,x:e.clientX,y:e.clientY};}},true);viewer.canvas.addEventListener('pointermove',(e)=>{if(!state.active||!touchLook||e.pointerId!==touchLook.id)return;const dx=e.clientX-touchLook.x,dy=e.clientY-touchLook.y;touchLook.x=e.clientX;touchLook.y=e.clientY;state.heading=C.Math.zeroToTwoPi(state.heading+dx*.006);state.pitch=C.Math.clamp(state.pitch-dy*.0045,C.Math.toRadians(-45),C.Math.toRadians(35));e.preventDefault();e.stopImmediatePropagation();},true);for(const type of ['pointerup','pointercancel'])viewer.canvas.addEventListener(type,(e)=>{if(touchLook&&e.pointerId===touchLook.id)touchLook=null;},true);

    window.MatsuyamaWalk={start,stop,toggleView,state};
  }
})();
