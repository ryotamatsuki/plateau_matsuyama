'use strict';
(function (global) {
  const SOURCE_SIZE = 256;
  const TERRAIN_SIZE = 65;
  const DEFAULT_MAX_SOURCE_LEVEL = 14;
  const MAX_CACHE_TILES = 48;

  function decodeHeight(r, g, b) {
    const x = r * 65536 + g * 256 + b;
    if (x === 8388608) return NaN;
    return (x < 8388608 ? x : x - 16777216) * 0.01;
  }

  async function decodeTile(url) {
    const response = await fetch(url, { cache: 'force-cache' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`DEM ${response.status}: ${url}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`DEM image decode failed: ${url}`));
        img.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = SOURCE_SIZE;
      canvas.height = SOURCE_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas is unavailable');
      ctx.drawImage(image, 0, 0, SOURCE_SIZE, SOURCE_SIZE);
      const rgba = ctx.getImageData(0, 0, SOURCE_SIZE, SOURCE_SIZE).data;
      const heights = new Float32Array(SOURCE_SIZE * SOURCE_SIZE);
      for (let i = 0, p = 0; i < heights.length; i++, p += 4) {
        heights[i] = decodeHeight(rgba[p], rgba[p + 1], rgba[p + 2]);
      }
      return heights;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function finiteWeighted(values, weights) {
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < values.length; i++) {
      if (Number.isFinite(values[i])) {
        sum += values[i] * weights[i];
        weight += weights[i];
      }
    }
    return weight > 0 ? sum / weight : 0;
  }

  function sampleDem(data, px, py) {
    if (!data) return 0;
    const x = Math.max(0, Math.min(SOURCE_SIZE - 1, px));
    const y = Math.max(0, Math.min(SOURCE_SIZE - 1, py));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(SOURCE_SIZE - 1, x0 + 1), y1 = Math.min(SOURCE_SIZE - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    return finiteWeighted(
      [
        data[y0 * SOURCE_SIZE + x0], data[y0 * SOURCE_SIZE + x1],
        data[y1 * SOURCE_SIZE + x0], data[y1 * SOURCE_SIZE + x1],
      ],
      [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy],
    );
  }

  function geoidHeight(model, lon, lat) {
    const rowF = (lat - model.originLat) / model.dLat;
    const colF = (lon - model.originLon) / model.dLon;
    if (rowF < 0 || colF < 0 || rowF > model.rows - 1 || colF > model.cols - 1) return 0;
    const r0 = Math.floor(rowF), c0 = Math.floor(colF);
    const r1 = Math.min(model.rows - 1, r0 + 1), c1 = Math.min(model.cols - 1, c0 + 1);
    const fr = rowF - r0, fc = colF - c0;
    const a = model.data[r0][c0], b = model.data[r0][c1];
    const c = model.data[r1][c0], d = model.data[r1][c1];
    if (![a, b, c, d].every(Number.isFinite)) return 0;
    return a * (1 - fc) * (1 - fr) + b * fc * (1 - fr) + c * (1 - fc) * fr + d * fc * fr;
  }

  function normalizedYToLatitude(y) {
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  }

  async function createGsiTerrainProvider(Cesium, options = {}) {
    const baseUrl = options.baseUrl || 'elevation';
    const manifestResponse = await fetch(`${baseUrl}/manifest.json`, { cache: 'no-cache' });
    if (!manifestResponse.ok) throw new Error(`elevation manifest ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    if (!manifest.complete) throw new Error('elevation cache is incomplete');
    const geoidResponse = await fetch(`${baseUrl}/geoid2011.json`, { cache: 'force-cache' });
    if (!geoidResponse.ok) throw new Error(`geoid model ${geoidResponse.status}`);
    const geoid = await geoidResponse.json();
    const maxSourceLevel = Number(manifest.maxZoom || DEFAULT_MAX_SOURCE_LEVEL);
    const cache = new Map();

    async function getTile(z, x, y) {
      const key = `${z}/${x}/${y}`;
      if (cache.has(key)) {
        const value = cache.get(key);
        cache.delete(key);
        cache.set(key, value);
        return value;
      }
      const promise = decodeTile(`${baseUrl}/dem_png/${z}/${x}/${y}.png`).catch((error) => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, promise);
      while (cache.size > MAX_CACHE_TILES) cache.delete(cache.keys().next().value);
      return promise;
    }

    const tilingScheme = new Cesium.WebMercatorTilingScheme();
    const provider = new Cesium.CustomHeightmapTerrainProvider({
      width: TERRAIN_SIZE,
      height: TERRAIN_SIZE,
      tilingScheme,
      credit: new Cesium.Credit('<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院 標高タイル・日本のジオイド2011</a>'),
      callback: async (x, y, level) => {
        const sourceLevel = Math.min(level, maxSourceLevel);
        const scale = 2 ** (level - sourceLevel);
        const sourceX = Math.floor(x / scale);
        const sourceY = Math.floor(y / scale);
        const childX = x - sourceX * scale;
        const childY = y - sourceY * scale;
        const dem = await getTile(sourceLevel, sourceX, sourceY);
        const output = new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE);
        const n = 2 ** level;

        for (let row = 0; row < TERRAIN_SIZE; row++) {
          const tv = row / (TERRAIN_SIZE - 1);
          const sourcePy = ((childY + tv) / scale) * SOURCE_SIZE;
          const globalY = (y + tv) / n;
          const lat = normalizedYToLatitude(globalY);
          for (let col = 0; col < TERRAIN_SIZE; col++) {
            const tu = col / (TERRAIN_SIZE - 1);
            const sourcePx = ((childX + tu) / scale) * SOURCE_SIZE;
            const globalX = (x + tu) / n;
            const lon = globalX * 360 - 180;
            const orthometric = sampleDem(dem, sourcePx, sourcePy);
            output[row * TERRAIN_SIZE + col] = orthometric + geoidHeight(geoid, lon, lat);
          }
        }
        return output;
      },
    });

    return { provider, manifest, geoid };
  }

  global.createGsiTerrainProvider = createGsiTerrainProvider;
})(window);
