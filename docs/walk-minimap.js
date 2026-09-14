'use strict';

(function installWalkMinimap() {
  if (window.__matsuyamaWalkMinimapInstalled) return;
  window.__matsuyamaWalkMinimapInstalled = true;

  const ZOOM = 17;
  const TILE_SIZE = 256;
  const UPDATE_MS = 120;
  let timer = 0;
  let lastTileKey = '';

  function waitForWalk() {
    const viewer = window.__matsuyamaViewer;
    const walk = window.MatsuyamaWalk;
    if (!window.Cesium || !viewer || viewer.isDestroyed?.() || !walk?.state) {
      setTimeout(waitForWalk, 80);
      return;
    }
    setup(window.Cesium, walk.state);
  }

  function setup(C, walkState) {
    if (document.getElementById('walkMinimap')) return;
    const main = document.querySelector('main');
    if (!main) return;

    const style = document.createElement('style');
    style.textContent = `
      #walkMinimap{position:absolute;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:14;width:168px;height:168px;overflow:hidden;border:1px solid #9bdbea;border-radius:13px;background:#dfe9e9;box-shadow:0 10px 30px #0008,inset 0 0 0 1px #ffffff55;pointer-events:none;user-select:none;-webkit-user-select:none;font-family:system-ui,sans-serif}
      #walkMinimap[hidden]{display:none!important}
      .walk-minimap-tiles{position:absolute;inset:0;overflow:hidden;background:#e7eded}
      .walk-minimap-tiles img{position:absolute;width:256px;height:256px;max-width:none;image-rendering:auto;pointer-events:none}
      .walk-minimap-shade{position:absolute;inset:0;box-shadow:inset 0 0 18px #08283b55;pointer-events:none}
      .walk-minimap-marker{position:absolute;left:50%;top:50%;width:28px;height:28px;transform:translate(-50%,-50%);filter:drop-shadow(0 2px 3px #0008)}
      .walk-minimap-arrow{position:absolute;left:7px;top:-4px;width:14px;height:23px;transform-origin:50% 18px;will-change:transform}
      .walk-minimap-arrow:before{content:"";position:absolute;left:1px;top:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:18px solid #04d8ff;filter:drop-shadow(0 0 1px #06394a)}
      .walk-minimap-dot{position:absolute;left:8px;top:12px;width:12px;height:12px;border:3px solid #fff;border-radius:50%;background:#0b8fd0;box-shadow:0 0 0 2px #07516d}
      .walk-minimap-north{position:absolute;left:7px;top:6px;padding:1px 4px;border-radius:5px;background:#0c2435d9;color:#fff;font:700 10px/1.4 system-ui;letter-spacing:.05em}
      .walk-minimap-title{position:absolute;left:6px;bottom:24px;padding:2px 6px;border-radius:5px;background:#0c2435d9;color:#fff;font:700 10px/1.35 system-ui}
      .walk-minimap-coord{position:absolute;left:6px;bottom:6px;padding:2px 5px;border-radius:5px;background:#0c2435d9;color:#e9f9ff;font:500 9px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
      .walk-minimap-source{position:absolute;right:5px;bottom:6px;padding:1px 4px;border-radius:4px;background:#ffffffd9;color:#1e3440;font:500 8px/1.3 system-ui}
      @media(max-width:700px),(pointer:coarse){
        #walkMinimap{right:max(12px,env(safe-area-inset-right));bottom:calc(max(18px,env(safe-area-inset-bottom)) + 166px);width:132px;height:132px;border-radius:11px}
        .walk-minimap-title{bottom:23px;font-size:9px}.walk-minimap-coord{font-size:7.5px}.walk-minimap-source{font-size:7px}.walk-minimap-north{font-size:9px}
      }
    `;
    document.head.appendChild(style);

    const minimap = document.createElement('div');
    minimap.id = 'walkMinimap';
    minimap.hidden = true;
    minimap.setAttribute('role', 'img');
    minimap.setAttribute('aria-label', '防災ウォークの現在地ミニマップ');
    minimap.innerHTML = `
      <div class="walk-minimap-tiles" aria-hidden="true"></div>
      <div class="walk-minimap-shade" aria-hidden="true"></div>
      <div class="walk-minimap-marker" aria-hidden="true"><div class="walk-minimap-arrow"></div><div class="walk-minimap-dot"></div></div>
      <div class="walk-minimap-north">N</div>
      <div class="walk-minimap-title">現在地</div>
      <div class="walk-minimap-coord">位置を取得中…</div>
      <div class="walk-minimap-source">地理院地図</div>`;
    main.appendChild(minimap);

    const tilesEl = minimap.querySelector('.walk-minimap-tiles');
    const arrowEl = minimap.querySelector('.walk-minimap-arrow');
    const coordEl = minimap.querySelector('.walk-minimap-coord');

    function worldPixel(lon, lat) {
      const n = Math.pow(2, ZOOM);
      const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
      const x = (lon + 180) / 360 * n * TILE_SIZE;
      const rad = safeLat * Math.PI / 180;
      const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n * TILE_SIZE;
      return { x, y, n };
    }

    function rebuildTiles(tileX, tileY, n) {
      tilesEl.replaceChildren();
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const img = document.createElement('img');
          const x = ((tileX + dx) % n + n) % n;
          const y = Math.max(0, Math.min(n - 1, tileY + dy));
          img.alt = '';
          img.draggable = false;
          img.dataset.dx = String(dx);
          img.dataset.dy = String(dy);
          img.src = `https://cyberjapandata.gsi.go.jp/xyz/std/${ZOOM}/${x}/${y}.png`;
          tilesEl.appendChild(img);
        }
      }
    }

    function positionTiles(lon, lat) {
      const p = worldPixel(lon, lat);
      const tileX = Math.floor(p.x / TILE_SIZE);
      const tileY = Math.floor(p.y / TILE_SIZE);
      const fracX = p.x - tileX * TILE_SIZE;
      const fracY = p.y - tileY * TILE_SIZE;
      const key = `${tileX}/${tileY}`;
      if (key !== lastTileKey || tilesEl.children.length !== 9) {
        lastTileKey = key;
        rebuildTiles(tileX, tileY, p.n);
      }
      const cx = minimap.clientWidth / 2;
      const cy = minimap.clientHeight / 2;
      for (const img of tilesEl.children) {
        const dx = Number(img.dataset.dx);
        const dy = Number(img.dataset.dy);
        img.style.left = `${cx - fracX + dx * TILE_SIZE}px`;
        img.style.top = `${cy - fracY + dy * TILE_SIZE}px`;
      }
    }

    function update() {
      if (!walkState.active || !document.body.classList.contains('walk-mode-active')) return;
      const lon = Number(walkState.lon);
      const lat = Number(walkState.lat);
      const headingRad = Number(walkState.heading);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

      positionTiles(lon, lat);
      const heading = Number.isFinite(headingRad) ? (C.Math.toDegrees(headingRad) + 360) % 360 : 0;
      arrowEl.style.transform = `rotate(${heading.toFixed(1)}deg)`;
      coordEl.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      minimap.dataset.latitude = lat.toFixed(7);
      minimap.dataset.longitude = lon.toFixed(7);
      minimap.dataset.heading = heading.toFixed(1);
    }

    function start() {
      if (timer) return;
      minimap.hidden = false;
      update();
      timer = window.setInterval(update, UPDATE_MS);
    }

    function stop() {
      if (timer) window.clearInterval(timer);
      timer = 0;
      minimap.hidden = true;
    }

    function syncVisibility() {
      if (walkState.active && document.body.classList.contains('walk-mode-active')) start();
      else stop();
    }

    const observer = new MutationObserver(syncVisibility);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('matsuyama-walk-active', syncVisibility);
    window.addEventListener('resize', () => {
      if (!minimap.hidden) update();
    }, { passive: true });
    syncVisibility();
  }

  waitForWalk();
})();
