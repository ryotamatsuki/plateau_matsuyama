from pathlib import Path


def replace_once(path: str, old: str, new: str, marker: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if marker in text:
        print(f"SKIP {path}: marker already present")
        return
    if old not in text:
        raise SystemExit(f"Expected source block not found in {path}: {marker}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"PATCH {path}: {marker}")


replace_once(
    "docs/gsi-terrain.js",
    "    return{provider,manifest,geoid,sampleOrthometricHeight};\n",
    "    async function sampleEllipsoidHeight(lon,lat){const orthometric=await sampleOrthometricHeight(lon,lat);return Number.isFinite(orthometric)?orthometric+geoidHeight(geoid,lon,lat):null;}\n    const api={provider,manifest,geoid,sampleOrthometricHeight,sampleEllipsoidHeight};\n    provider.__matsuyamaGsiTerrainApi=api;\n    global.MatsuyamaTerrain=api;\n    return api;\n",
    "sampleEllipsoidHeight",
)

replace_once(
    "docs/walk-mode.js",
    """    function globeHeight(lon, lat) {
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
""",
    """    function plausibleTerrainHeight(h) {
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
      const h = await authoritativeTerrainHeight(state.lon, state.lat);
      if (!state.active) return;
      if (h !== null) {
        state.ground = h;
        if(groundEl.textContent!=='地形追従')groundEl.textContent = '地形追従';
        updateAvatar(); cameraPose();
      } else {
        groundEl.textContent = '地形読込中';
      }
    }
""",
    "authoritativeTerrainHeight",
)

replace_once(
    "docs/walk-mode.js",
    """      const h = globeHeight(state.lon, state.lat);
      if (h !== null) state.ground = h;
      setView('third');
""",
    """      const h = globeHeight(state.lon, state.lat);
      if (plausibleTerrainHeight(h)) state.ground = h;
      setView('third');
""",
    "if (plausibleTerrainHeight(h)) state.ground = h;",
)

replace_once(
    "docs/navigation-controller.js",
    """  function terrainHeight(lon, lat) {
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
""",
    """  function plausibleTerrainHeight(h) {
    return Number.isFinite(h) && h > -500 && h < 3000;
  }

  function terrainHeight(lon, lat) {
    try {
      const h = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
      return plausibleTerrainHeight(h) ? h : null;
    } catch (_) { return null; }
  }

  async function resolveTerrainHeight(lon, lat, fallback = 0) {
    const sampler = window.MatsuyamaTerrain && window.MatsuyamaTerrain.sampleEllipsoidHeight;
    if (typeof sampler === 'function') {
      try {
        const h = await sampler(lon, lat);
        if (plausibleTerrainHeight(h)) return h;
      } catch (_) {}
    }
    const immediate = terrainHeight(lon, lat);
    if (immediate !== null) return immediate;
    return plausibleTerrainHeight(fallback) ? fallback : 0;
  }
""",
    "plausibleTerrainHeight",
)

replace_once(
    "docs/navigation-controller.js",
    """  async function landingTarget() {
    const point = centerTerrainPoint();
    const cart = C.Cartographic.fromCartesian(point);
    const lon = C.Math.toDegrees(cart.longitude), lat = C.Math.toDegrees(cart.latitude);
    const fallback = terrainHeight(lon, lat) ?? cart.height ?? state.lastFocus.ground ?? 0;
    const ground = await resolveTerrainHeight(lon, lat, fallback);
    return { lon, lat, ground };
  }
""",
    """  async function landingTarget() {
    const point = centerTerrainPoint();
    const cart = C.Cartographic.fromCartesian(point);
    let lon = C.Math.toDegrees(cart.longitude), lat = C.Math.toDegrees(cart.latitude);
    if (!(lon >= 132.45 && lon <= 132.97 && lat >= 33.65 && lat <= 34.13)) {
      lon = state.lastFocus.lon;
      lat = state.lastFocus.lat;
    }
    const rendered = terrainHeight(lon, lat);
    const picked = plausibleTerrainHeight(cart.height) ? cart.height : null;
    const remembered = plausibleTerrainHeight(state.lastFocus.ground) ? state.lastFocus.ground : null;
    const fallback = rendered ?? picked ?? remembered ?? 0;
    const ground = await resolveTerrainHeight(lon, lat, fallback);
    return { lon, lat, ground };
  }
""",
    "const picked = plausibleTerrainHeight(cart.height)",
)

replace_once(
    "docs/navigation-controller.js",
    """    // walk.start() samples the currently-rendered globe height synchronously before
    // its detailed terrain refinement completes. On a freshly deployed Pages load,
    // that rendered LOD can differ materially from sampleTerrainMostDetailed().
    // The landing target above is the authoritative detailed terrain height, so
    // restore it after start() and immediately rebuild the walk camera from it.
""",
    """    // walk.start() may see a coarse/stale rendered globe height synchronously.
    // The landing target is resolved directly from the cached GSI DEM10B + geoid
    // sampler, so restore that authoritative value before rebuilding the walk camera.
""",
    "cached GSI DEM10B + geoid",
)

replace_once(
    "tests/navigation-e2e.mjs",
    """  await page.waitForFunction(() => window.__matsuyamaViewer && window.MatsuyamaWalk && window.MatsuyamaNavigation?.debug, null, { timeout });
""",
    """  await page.waitForFunction(() => window.__matsuyamaViewer && window.MatsuyamaWalk && window.MatsuyamaNavigation?.debug && window.MatsuyamaTerrain?.sampleEllipsoidHeight, null, { timeout });
""",
    "window.MatsuyamaTerrain?.sampleEllipsoidHeight",
)

replace_once(
    "tests/navigation-e2e.mjs",
    """  assert.ok(debug.lastLanding && Number.isFinite(debug.lastLanding.ground));
  const sync=await page.evaluate(()=>({
""",
    """  assert.ok(debug.lastLanding && Number.isFinite(debug.lastLanding.ground));
  assert.ok(debug.lastLanding.ground>-500 && debug.lastLanding.ground<3000,`implausible landing height ${debug.lastLanding.ground}`);
  const authoritative=await page.evaluate(async()=>window.MatsuyamaTerrain.sampleEllipsoidHeight(window.MatsuyamaNavigation.debug().lastLanding.lon,window.MatsuyamaNavigation.debug().lastLanding.lat));
  assert.ok(Number.isFinite(authoritative) && Math.abs(authoritative-debug.lastLanding.ground)<0.05,`landing is not using authoritative DEM height: ${authoritative} vs ${debug.lastLanding.ground}`);
  const sync=await page.evaluate(()=>({
""",
    "landing is not using authoritative DEM height",
)

print("DEM height authority patch complete")
