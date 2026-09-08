'use strict';
(function installMatsuyamaDataStore(global) {
  if (global.MatsuyamaData) return;
  const jsonPromises = new Map();
  let buildingRiskPromise = null;
  const waterPromises = new Map();
  const CELL_SIZE = 0.01;
  const abs = (path) => new URL(path, document.baseURI).href;
  function loadJson(path, cache = 'force-cache') {
    const key = abs(path);
    if (jsonPromises.has(key)) return jsonPromises.get(key);
    const promise = fetch(path, { cache }).then((r) => {
      if (!r.ok) throw new Error(`${path} ${r.status}`);
      return r.json();
    }).catch((e) => { jsonPromises.delete(key); throw e; });
    jsonPromises.set(key, promise);
    return promise;
  }
  function buildingRisk() {
    if (buildingRiskPromise) return buildingRiskPromise;
    buildingRiskPromise = loadJson('analysis/building-risk.json').then((raw) => {
      const schema = Object.fromEntries((raw.schema || []).map((name, i) => [name, i]));
      const records = raw.records || [];
      const byId = new Map();
      const cells = new Map();
      const lonIndex = schema.lon, latIndex = schema.lat;
      const idIndexes = [schema.key, schema.sourceId].filter((v, i, a) => v !== undefined && a.indexOf(v) === i);
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        for (const idx of idIndexes) {
          const value = rec[idx];
          if (value !== null && value !== undefined && value !== '') byId.set(String(value), rec);
        }
        const lon = Number(lonIndex === undefined ? NaN : rec[lonIndex]);
        const lat = Number(latIndex === undefined ? NaN : rec[latIndex]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const key = `${Math.floor(lon / CELL_SIZE)},${Math.floor(lat / CELL_SIZE)}`;
        let bucket = cells.get(key);
        if (!bucket) cells.set(key, bucket = []);
        bucket.push(i);
      }
      function queryBounds(west, south, east, north) {
        const out = [];
        const ix0 = Math.floor(west / CELL_SIZE), ix1 = Math.floor(east / CELL_SIZE);
        const iy0 = Math.floor(south / CELL_SIZE), iy1 = Math.floor(north / CELL_SIZE);
        for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) {
          const bucket = cells.get(`${ix},${iy}`);
          if (!bucket) continue;
          for (const index of bucket) {
            const rec = records[index], lon = Number(rec[lonIndex]), lat = Number(rec[latIndex]);
            if (lon >= west && lon <= east && lat >= south && lat <= north) out.push(index);
          }
        }
        out.sort((a, b) => a - b);
        return out.map((i) => records[i]);
      }
      return { raw, schema, byId, cells, cellSize: CELL_SIZE, queryBounds };
    }).catch((e) => { buildingRiskPromise = null; throw e; });
    return buildingRiskPromise;
  }
  function waterScenario(name) {
    if (name !== 'flood' && name !== 'tsunami') return Promise.reject(new Error(`unknown water scenario: ${name}`));
    if (waterPromises.has(name)) return waterPromises.get(name);
    const promise = loadJson(`analysis/water3d/${name}.json`).catch((e) => { waterPromises.delete(name); throw e; });
    waterPromises.set(name, promise);
    return promise;
  }
  global.MatsuyamaData = Object.freeze({ loadJson, buildingRisk, waterScenario });
})(window);
